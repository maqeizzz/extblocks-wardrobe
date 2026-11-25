import { system_avatar, system_message_types } from '../../../../../../script.js';
import { BlockService } from './BlockService.js';
import { GenerationService } from './GenerationService.js';
import { ContextService } from './ContextService.js';
import { MacroService } from './MacroService.js';
import { extStates } from '../core/state.js';

const {
    substituteParams,
    chat,
    saveChat,
    addOneMessage,
    eventSource,
    event_types,
    extensionSettings,
    saveSettingsDebounced,
    characters,
} = SillyTavern.getContext();

export const CommandService = {
    /**
     * Callback for the generate slash command.
     */
    async runBlockGenerationCallback(args, additional_prompt) {
        if (!args.name) {
            toastr.warning(`No block name provided`);
            return '';
        }
        const block_names = args.name.split(',').map((name) => name.trim());

        const allBlocks = BlockService.getBlocksByType(['generated']);
        const blocks = allBlocks.filter((e) => block_names.includes(e.name));
        if (blocks.length > 0) {
            const messageId = chat.length - 1;
            let additionalMacro = {};
            if (additional_prompt) {
                additionalMacro = { additionalPrompt: substituteParams(additional_prompt) }
            }
            let is_separate = false;
            if (args.is_separate) {
                is_separate = args.is_separate;
            }
            const generatedBlocksList = await GenerationService.handleBlocksGeneration(messageId, false, allBlocks, blocks, additionalMacro, is_separate);
            if (generatedBlocksList && generatedBlocksList.length > 0) {
                const combinedGeneratedContent = generatedBlocksList.join('\n');
                const allEnabledBlocks = BlockService.getAllEnabledBlocks();
                await GenerationService.handleBlocksAccumulation(messageId, false, allEnabledBlocks, combinedGeneratedContent);
            }
        } else {
            toastr.warning(`Blocks not found.`);
        }
        return '';
    },

    /**
     * Callback for the rewrite slash command.
     */
    async runRewriteBlocksCallback(args, additional_prompt) {
        if (!args.name) {
            toastr.warning(`No block name provided`);
            return '';
        }
        const block_names = args.name.split(',').map((name) => name.trim());

        const allBlocks = BlockService.getBlocksByType(['rewrite']);
        const blocks = allBlocks.filter((e) => block_names.includes(e.name));
        if (blocks.length > 0) {
            const messageId = chat.length - 1;
            let additionalMacro = {};
            if (additional_prompt) {
                additionalMacro = { additionalPrompt: substituteParams(additional_prompt) }
            }
            let is_separate = false;
            await GenerationService.handleBlocksGeneration(messageId, false, allBlocks, blocks, additionalMacro, is_separate);
        } else {
            toastr.warning(`Blocks not found.`);
        }
        return '';
    },

    /**
     * Callback for the execute-script slash command.
     */
    async runScriptsExecutionCallback(args, _) {
        if (!args.name) {
            toastr.warning(`No block name provided`);
            return '';
        }
        const block_names = args.name.split(',').map((name) => name.trim());

        const allBlocks = BlockService.getBlocksByType(['script']);
        const blocks = allBlocks.filter((e) => block_names.includes(e.name));
        if (blocks.length > 0) {
            const messageId = chat.length - 1;
            await GenerationService.handleBlocksGeneration(messageId, false, allBlocks, blocks, {}, false);
        } else {
            toastr.warning(`Blocks not found.`);
        }
        return '';
    },

    /**
     * Callback for the regenerate slash command.
     */
    async runBlockRegenerationCallback() {
        const messageId = chat.length - 1;
        if (messageId <= 0) return;
        const message = chat[messageId];
        const swipe = message.swipe_id;
        const previousBlocks = BlockService.getBlocksFromExtra(messageId);

        await BlockService.purgeBlocksExtra(messageId);

        try {
            await GenerationService.handleMessageTrigger(messageId, message.is_user);
        } catch (error) {
            if (previousBlocks && chat[messageId] === message && message.swipe_id === swipe
                && !BlockService.getBlocksFromExtra(messageId)) {
                try {
                    await BlockService.addBlocksToExtra(messageId, previousBlocks);
                } catch (restoreError) {
                    console.error('[ExtBlocks] Could not restore previous generated blocks:', restoreError);
                }
            }
            throw error;
        }
        return '';
    },

    /**
     * Callback for the storage-append slash command.
     */
    async appendStringToExtraCallback(_, blocksStr) {
        await BlockService.addBlocksToExtra(chat.length - 1, blocksStr);
        return '';
    },

    /**
     * Callback for the storage-purge slash command.
     */
    async purgeExtraCallback() {
        await BlockService.purgeBlocksExtra(chat.length - 1);
        return '';
    },

    /**
     * Callback for the storage-export slash command.
     */
    async exportBlocksCallback() {
        if (SillyTavern.getContext().characterId !== undefined) {
            const blocks = BlockService.getAllEnabledBlocks();
            let blocksStrArray = [];
            blocks.forEach(block => {
                blocksStrArray.push(ContextService.getPreviousBlockContextUnconditional(block, chat.length - 1, true).trim());
            });
            const blocksStr = blocksStrArray.join('\n\n');

            const message = {
                name: 'System',
                is_user: false,
                is_system: true,
                mes: blocksStr,
                force_avatar: system_avatar,
                extra: {
                    type: system_message_types.NARRATOR,
                    bias: null,
                    gen_id: Date.now(),
                    api: 'manual',
                    model: 'slash command',
                },
            };
            chat.push(message);
            await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
            addOneMessage(message);
            await eventSource.emit(event_types.USER_MESSAGE_RENDERED, (chat.length - 1));
            await saveChat();
        }
        return '';
    },

    /**
     * Callback for the status slash command.
     */
    async toggleExtensionCallback(_, value) {
        const isEnabled = String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'on' || value === '1';
        extensionSettings.ExtBlocks.extblocks_is_enabled = isEnabled;
        if (isEnabled) {
            await BlockService.updateDisplayForBlocks();
            MacroService.registerExtensionMacros();
        } else {
            MacroService.unregisterExtensionMacros();
            if (SillyTavern.getContext().characterId !== undefined) {
                await BlockService.purgeAllBlocksDisplayText();
                BlockService.removeAllBlockInjects();
            }
        }
        saveSettingsDebounced();
        $('#extblocks_is_enabled').prop('checked', isEnabled);
        return '';
    },

    /**
     * Callback for the block-status slash command.
     */
    async toggleBlockCallback(args, value) {
        if (!args.name) {
            toastr.warning(`No block name provided`);
            return '';
        }
        const isEnabled = String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'on' || value === '1';
        const scope = args.scope || 'preset';
        const isScoped = scope === 'scoped';
        const name = args.name;

        const blocks = isScoped
            ? (characters[SillyTavern.getContext().characterId]?.data?.extensions?.ExtBlocks ?? [])
            : (extStates.current_set?.global_blocks ?? []);
            
        const block = blocks.find(b => b.name === name);
        if (block) {
            block.disabled = !isEnabled;
            if (block.disabled) {
                BlockService.removeBlockInject(block);
            }
            await BlockService.saveBlock(block, isScoped);
            $(`#${block.id} .disable_ExtBlocks`).prop('checked', block.disabled);
        } else {
            toastr.error(`Block "${name}" not found in ${scope} scope.`);
        }
        return '';
    }
};
