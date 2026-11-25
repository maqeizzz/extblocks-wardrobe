import { proxies, chat_completion_sources, oai_settings } from '../../../../../openai.js';
import { getEventSourceStream } from '../../../../../sse-stream.js';
import { getPresetManager } from '../../../../../preset-manager.js';

import { extStates } from '../core/state.js';
import { MessageRole, defaultExtPrefix } from '../core/constants.js';
import { SettingsService } from './SettingsService.js';

const { getRequestHeaders, extensionSettings } = SillyTavern.getContext();
const activeRequests = new Set();

export const ApiService = {
    /**
     * Loads the API preset into the UI.
     */
    async loadApiPreset() {
        await SettingsService.refreshSettings();
        const preset = extStates.api_preset;
        this.refreshConnectionProfiles();
        $('#ExtBlocks-proxy-temperature').val(preset.temperature);
        $('#ExtBlocks-proxy-topp').val(preset.top_p);
        $('#ExtBlocks-proxy-maxtokens').val(preset.max_tokens);
        $('#ExtBlocks-proxy-reasoningeffort').val(preset.reasoning_effort);
        $('#ExtBlocks-proxy-stream').prop('checked', preset.stream);
        $('#ExtBlocks-enable-jb').prop('checked', preset.confirmation_jb ?? false);
    },

    /**
     * Refreshes the connection profiles list in the UI.
     */
    refreshConnectionProfiles() {
        const select = $('#ExtBlocks-proxy-connection-profile');
        select.empty();
        select.append(new Option('Select a connection profile', ''));
        for (const profile of extensionSettings.connectionManager.profiles) {
            if (profile.mode === 'cc') select.append(new Option(profile.name, profile.id));
        }
        const profile = this.getConnectionProfile(extStates.api_preset);
        select.val(profile?.mode === 'cc' ? profile.id : '');
    },

    /**
     * Initializes the API settings.
     */
    async loadAPI() {
        $('#ExtBlocks-api-preset').val(extStates.ExtBlocks_settings.active_api_preset);
        await this.loadApiPreset();
    },

    /**
     * Gets an API preset by name.
     */
    getApiPreset(presetName) {
        if (!presetName) return extStates.api_preset;
        const preset = extStates.ExtBlocks_settings.api_presets[presetName];
        if (preset) return preset;
        else return extStates.api_preset;
    },

    /**
     * Gets a connection profile for a given preset.
     */
    getConnectionProfile(apiPreset = extStates.api_preset) {
        const { profiles } = extensionSettings.connectionManager;
        const reference = apiPreset?.connection_profile;
        if (reference == null) return profiles.find(profile => profile.mode === 'cc');
        return profiles.find(profile => profile.id === reference)
            ?? profiles.find(profile => profile.name === reference);
    },

    /**
     * Validates if the connection profile is defined and has the required fields.
     * @param {object} connection_profile Connection profile object.
     */
    validateConnectionProfile(connection_profile) {
        if (!connection_profile) {
            toastr.error('[ExtBlocks] Connection profile is not defined.');
            throw new Error('Connection profile is not defined.');
        }
        if (!connection_profile.mode || !connection_profile.api || !connection_profile.model) {
            toastr.error('[ExtBlocks] Connection profile is missing required fields: mode, api and/or model.');
            throw new Error('Connection profile is missing required fields: mode, api and/or model.');
        }
        if (connection_profile.mode !== 'cc') {
            toastr.error('[ExtBlocks] Only the `cc` mode is supported for connection profiles.');
            throw new Error('Only the `cc` mode is supported for connection profiles.');
        }
    },

    /**
     * Maps API names to chat completion sources.
     */
    getChatCompletionSource(apiName) {
        if (apiName === 'google') return chat_completion_sources.MAKERSUITE;
        else return apiName;
    },

    /**
     * Extracts the reply from a streaming response.
     */
    getStreamingReply(data, cc_source) {
        if (cc_source === chat_completion_sources.CLAUDE) {
            return data?.delta?.text || '';
        } else if (cc_source === chat_completion_sources.MAKERSUITE) {
            return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
            return data?.choices?.[0]?.delta?.content ?? data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
        }
    },

    /**
     * Prepares the data for the generation request.
     */
    prepareGenerateData(preset, connection_profile, cc_source, messages) {
        const stream = preset.stream ?? false;
        let generate_data = {
            'messages': messages,
            'model': connection_profile.model,
            'secret_id': connection_profile['secret-id'],
            'temperature': preset.temperature,
            'stream': stream,
            'chat_completion_source': cc_source,
            'max_tokens': preset.max_tokens
        };

        // Samplers
        let top_p = preset.top_p;
        if (preset.top_p !== 1.0) {
            if (cc_source === chat_completion_sources.COHERE) {
                top_p = Math.min(Math.max(Number(top_p), 0.01), 0.99);
            }
            generate_data['top_p'] = top_p;
        }

        // Reasoning effort
        const reasoning_effort = preset.reasoning_effort;
        if (reasoning_effort && reasoning_effort !== 'none') {
            generate_data['reasoning_effort'] = reasoning_effort;
            generate_data['include_reasoning'] = true;
        }

        // Post-processing
        const post_processing = connection_profile["prompt-post-processing"];
        if (post_processing) {
            generate_data['custom_prompt_post_processing'] = post_processing;
        }

        // Connection settings
        const profilePreset = connection_profile.preset
            ? getPresetManager('openai')?.getCompletionPresetByName(connection_profile.preset)
            : undefined;
        const isActiveProfile = extensionSettings.connectionManager.selectedProfile === connection_profile.id
            && oai_settings.chat_completion_source === cc_source;
        const settings = { ...(isActiveProfile ? oai_settings : {}), ...profilePreset };
        const api_url = connection_profile['api-url'];
        if (connection_profile.proxy) {
            const proxy_preset = proxies.find(p => p.name === connection_profile.proxy);
            if (proxy_preset?.url) {
                generate_data['reverse_proxy'] = proxy_preset.url;
                generate_data['proxy_password'] = proxy_preset.password;
            }
        } 
        if (cc_source === chat_completion_sources.CUSTOM) {
            const customUrl = api_url?.trim() || settings.custom_url?.trim();
            if (!customUrl) {
                toastr.error('[ExtBlocks] No URL has been specified for the selected connection profile.');
                throw new Error('No URL has been specified for the selected connection profile.');
            }
            generate_data["custom_url"] = customUrl.replace(/\/+$/, '');
            generate_data["custom_prompt_post_processing"] = post_processing ?? settings.custom_prompt_post_processing;
            settings.custom_include_body !== undefined && (generate_data["custom_include_body"] = settings.custom_include_body);
            settings.custom_exclude_body !== undefined && (generate_data["custom_exclude_body"] = settings.custom_exclude_body);
            settings.custom_include_headers !== undefined && (generate_data["custom_include_headers"] = settings.custom_include_headers);
        } else if (cc_source === chat_completion_sources.VERTEXAI) {
            if (!settings.vertexai_region && !api_url) {
                toastr.error('[ExtBlocks] No VertexAI Region has been specified for the selected connection profile.');
                throw new Error('No VertexAI Region has been specified for the selected connection profile.');
            }
            generate_data['vertexai_region'] = api_url ?? settings.vertexai_region;
            settings.vertexai_auth_mode !== undefined && (generate_data['vertexai_auth_mode'] = settings.vertexai_auth_mode);
            settings.vertexai_express_project_id !== undefined && (generate_data['vertexai_express_project_id'] = settings.vertexai_express_project_id);
        } else if (cc_source === chat_completion_sources.ZAI && !connection_profile.proxy && api_url) {
            generate_data['zai_endpoint'] = api_url;
        } else if (cc_source === chat_completion_sources.OPENROUTER) {
            generate_data['use_fallback'] = settings.openrouter_use_fallback;
            generate_data['provider'] = settings.openrouter_providers;
            generate_data['quantizations'] = settings.openrouter_quantizations;
            generate_data['allow_fallbacks'] = settings.openrouter_allow_fallbacks;
            generate_data['middleout'] = settings.openrouter_middleout;
        }

        // Additional fields
        if (cc_source === chat_completion_sources.MAKERSUITE || cc_source === chat_completion_sources.VERTEXAI || cc_source === chat_completion_sources.CLAUDE) {
            generate_data['use_sysprompt'] = true;
        }

        return generate_data;
    },

    /**
     * Generates blocks using the specified messages and preset.
     */
    async generateBlocks(messages, apiPresetName) {
        const preset = this.getApiPreset(apiPresetName);
        const connection_profile = this.getConnectionProfile(preset);
        this.validateConnectionProfile(connection_profile);
        const cc_source = this.getChatCompletionSource(connection_profile.api);

        if (preset.confirmation_jb) {
            messages.push({ role: MessageRole.ASSISTANT, content: "[Please confirm your request]" })
            messages.push({ role: MessageRole.USER, content: "[I confirm]" })
        }

        const generate_data = this.prepareGenerateData(preset, connection_profile, cc_source, messages);
        const stream = generate_data.stream;

        const controller = new AbortController();
        activeRequests.add(controller);
        try {
            const response = await fetch('/api/backends/chat-completions/generate', {
                method: 'POST',
                body: JSON.stringify(generate_data),
                headers: getRequestHeaders(),
                signal: controller.signal,
            });
            if (!response.ok) {
                const hint = response.status === 401 || response.status === 403
                    ? ' Check the API key and access permissions for this profile.'
                    : '';
                throw new Error(`Profile "${connection_profile.name}" returned HTTP ${response.status}.${hint}`);
            }
            let data;

            if (stream) {
                const eventStream = getEventSourceStream();
                const reader = response.body.pipeThrough(eventStream).getReader();
                let text = '';
                const swipes = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const rawData = value.data;
                    if (rawData === '[DONE]') break;
                    const parsed = JSON.parse(rawData);
                    if (parsed.error) throw new Error(`Profile "${connection_profile.name}" returned an API error.`);

                    if (Array.isArray(parsed?.choices) && parsed?.choices?.[0]?.index > 0) {
                        const swipeIndex = parsed.choices[0].index - 1;
                        swipes[swipeIndex] = (swipes[swipeIndex] || '') + this.getStreamingReply(parsed, cc_source);
                    } else {
                        text += this.getStreamingReply(parsed, cc_source);
                    }
                }
                data = { content: text, swipes: swipes };
            } else {
                data = await response.json();

                if (data.error) {
                    throw new Error(`Profile "${connection_profile.name}" returned an API error.`);
                }
            }

            return data;
        } catch (error) {
            if (!controller.signal.aborted) {
                toastr.error(error.message, 'ExtBlocks generation failed', { escapeHtml: true });
            }
            throw error;
        } finally {
            controller.abort();
            activeRequests.delete(controller);
        }
    },

    /**
     * Extracts the message content from the API response.
     */
    extractMessageFromData(data) {
        if (typeof data.content === 'string') {
            return data.content.trim();
        } else {
            return data.content?.filter(p => p.type === 'text')?.map(p => p.text)?.join('\n\n') ?? data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.text ?? data?.message?.content?.[0]?.text ?? data?.message?.tool_plan ?? '';
        }
    },

    /**
     * Aborts the current generation.
     */
    abortGeneration() {
        if (activeRequests.size) {
            for (const controller of activeRequests) controller.abort();
            toastr.info(`${defaultExtPrefix} Generation aborted.`);
        }
    }
};
