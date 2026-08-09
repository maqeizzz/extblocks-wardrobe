import { BlockType, RewriteMode, MessageRole, defaultExtPrefix } from '../core/constants.js';
import { ApiService } from '../services/ApiService.js';
import { BlockService } from '../services/BlockService.js';
import { MacroService } from '../services/MacroService.js';
import { getMultiBlockContentFromMessage } from '../utils/blockUtils.js';
import {
    applySearchReplaceDiff,
    isSearchReplaceNoChanges,
    parseSearchReplaceDiff,
    searchReplaceDiffProtocol,
    searchReplaceDiffTemplate,
} from '../utils/searchReplaceDiffUtils.js';
import { getRegexedString } from '../../../../../extensions/regex/engine.js';

const { chat, saveChat } = SillyTavern.getContext();

/**
 * Plugin for handling Rewrite blocks.
 */
export const RewritePlugin = {
    type: BlockType.REWRITE,

    /**
     * Generates and interprets a rewrite response.
     * @returns {Promise<{rewrittenText: string, mode: string, hunksApplied: number, noChanges?: boolean}>}
     */
    async generateRewriteResult(rewriteBlock, messageId, allBlocks, additionalMacro = {}, applyRegex = false) {
        const hasExplicitTarget = Object.prototype.hasOwnProperty.call(additionalMacro, 'textToRewrite');
        const sourceText = hasExplicitTarget ? String(additionalMacro.textToRewrite ?? '') : String(chat[messageId]?.mes ?? '');
        const localMacro = { ...additionalMacro, textToRewrite: sourceText };
        const rewriteMode = rewriteBlock.rewrite_mode ?? RewriteMode.FULL;

        const promptBlock = rewriteMode === RewriteMode.SEARCH_REPLACE
            ? { ...rewriteBlock, template: searchReplaceDiffTemplate }
            : rewriteBlock;
        let fullPrompt = BlockService.getSingleBlockFullPrompt(promptBlock, messageId, allBlocks, localMacro);
        if (rewriteMode === RewriteMode.SEARCH_REPLACE) {
            fullPrompt.unshift({ role: MessageRole.SYSTEM, content: searchReplaceDiffProtocol });
        }
        fullPrompt = await MacroService.checkAllMacros(fullPrompt);

        const blocksData = await ApiService.generateBlocks(fullPrompt, rewriteBlock.api_preset);
        const preset = ApiService.getApiPreset(rewriteBlock.api_preset);
        const responseText = ApiService.extractMessageFromData(blocksData, preset);

        if (!responseText || responseText.includes('Proxy error')) {
            throw new Error('The API returned an empty or invalid rewrite response.');
        }

        if (rewriteMode === RewriteMode.SEARCH_REPLACE) {
            if (isSearchReplaceNoChanges(responseText)) {
                return {
                    rewrittenText: sourceText,
                    mode: rewriteMode,
                    hunksApplied: 0,
                    noChanges: true,
                };
            }

            let hunks = parseSearchReplaceDiff(responseText);
            if (applyRegex && rewriteBlock.apply_regex) {
                hunks = hunks.map(hunk => ({
                    ...hunk,
                    replace: getRegexedString(hunk.replace, 2, { depth: 0, isPrompt: true }),
                }));
            }
            const result = applySearchReplaceDiff(sourceText, hunks);
            return {
                rewrittenText: result.text,
                mode: rewriteMode,
                hunksApplied: result.appliedCount,
            };
        }

        let rewrittenText = getMultiBlockContentFromMessage(responseText, 'rewritten text');
        if (applyRegex && rewriteBlock.apply_regex) {
            rewrittenText = getRegexedString(rewrittenText, 2, { depth: 0, isPrompt: true });
        }
        if (!rewrittenText) {
            throw new Error('No <rewritten text> content was found in the model response.');
        }

        return { rewrittenText, mode: RewriteMode.FULL, hunksApplied: 0 };
    },

    /**
     * Generates a rewrite for a specific block. This public API returns the
     * final rewritten target for both full-text and Search/Replace modes.
     */
    async generateRewrite(rewriteBlock, messageId, allBlocks, additionalMacro = {}) {
        const result = await this.generateRewriteResult(rewriteBlock, messageId, allBlocks, additionalMacro);
        return result.rewrittenText;
    },

    _getRewriteTarget(messageText, additionalMacro, rewriteTarget) {
        const hasExplicitTarget = Object.prototype.hasOwnProperty.call(additionalMacro, 'textToRewrite');
        if (!hasExplicitTarget) {
            return { kind: 'message', text: messageText, start: 0, end: messageText.length };
        }

        const targetText = String(additionalMacro.textToRewrite ?? '');
        const start = Number(rewriteTarget?.start);
        const end = Number(rewriteTarget?.end);
        const hasValidRange = Number.isInteger(start)
            && Number.isInteger(end)
            && start >= 0
            && end >= start
            && end <= messageText.length;

        if (hasValidRange) {
            if (messageText.slice(start, end) !== targetText) {
                throw new Error('The selected rewrite range no longer matches the message text.');
            }
            return { kind: 'range', text: targetText, start, end };
        }

        if (targetText === messageText) {
            return { kind: 'message', text: messageText, start: 0, end: messageText.length };
        }
        if (targetText.length === 0) {
            throw new Error('The partial rewrite target is empty.');
        }

        const firstMatch = messageText.indexOf(targetText);
        if (firstMatch === -1) {
            throw new Error('The partial rewrite target was not found in the message.');
        }
        if (messageText.indexOf(targetText, firstMatch + 1) !== -1) {
            throw new Error('The partial rewrite target is ambiguous. Select it in the message editor to provide an exact range.');
        }

        return {
            kind: 'range',
            text: targetText,
            start: firstMatch,
            end: firstMatch + targetText.length,
        };
    },

    /**
     * Executes the rewrite blocks.
     * @param {Object[]} blocks - The rewrite blocks to process.
     * @param {Object} options - Execution options.
     * @param {number} options.messageId - The ID of the message being processed.
     * @param {Object[]} options.allBlocks - All enabled blocks.
     * @param {string} [options.generation_order] - Filter by generation order ('before' or 'after').
     * @param {Object} [options.additionalMacro] - Additional macros for substitution.
     * @param {{start: number, end: number}} [options.rewriteTarget] - Exact partial rewrite range.
     */
    async execute(blocks, options = {}) {
        const { messageId, allBlocks, generation_order, additionalMacro = {}, rewriteTarget } = options;
        const blocksToProcess = generation_order
            ? blocks.filter(block => block.generation_order === generation_order)
            : blocks;

        if (blocksToProcess.length === 0) return;
        if (!chat[messageId]) {
            toastr.error(`${defaultExtPrefix} Rewrite target message was not found.`);
            return;
        }

        toastr.info(`${defaultExtPrefix} Rewriting, please wait...`);

        let target;
        try {
            target = this._getRewriteTarget(chat[messageId].mes, additionalMacro, rewriteTarget);
        } catch (error) {
            console.error(`${defaultExtPrefix} Rewrite target error:`, error);
            toastr.error(`${defaultExtPrefix} ${error.message}`);
            return;
        }

        let hadFailure = false;
        let hadSuccess = false;
        const localMacro = { ...additionalMacro, textToRewrite: target.text };

        for (const rewriteBlock of blocksToProcess) {
            try {
                localMacro.textToRewrite = target.text;
                const result = await this.generateRewriteResult(rewriteBlock, messageId, allBlocks, localMacro, true);
                const rewrittenText = result.rewrittenText;

                if (target.kind === 'range') {
                    chat[messageId].mes = chat[messageId].mes.slice(0, target.start)
                        + rewrittenText
                        + chat[messageId].mes.slice(target.end);
                    target.end = target.start + rewrittenText.length;
                } else {
                    chat[messageId].mes = rewrittenText;
                    target.end = rewrittenText.length;
                }

                target.text = rewrittenText;
                hadSuccess = true;
            } catch (error) {
                hadFailure = true;
                console.error(`${defaultExtPrefix} Rewrite block "${rewriteBlock.name}" failed:`, error);
                toastr.warning(`${defaultExtPrefix} Rewrite block "${rewriteBlock.name}" failed: ${error.message}`);
            }
        }

        if (hadSuccess) {
            const message = chat[messageId];
            const swipeId = message.swipe_id;
            if (Array.isArray(message.swipes) && swipeId !== undefined && swipeId !== null) {
                message.swipes[swipeId] = message.mes;
            }

            await BlockService.updateBlocksDisplay(messageId);
            await saveChat();
        }

        if (hadSuccess && !hadFailure) {
            toastr.success(`${defaultExtPrefix} Rewriting is done!`);
        } else if (hadSuccess) {
            toastr.warning(`${defaultExtPrefix} Rewriting was only partially successful.`);
        } else {
            toastr.error(`${defaultExtPrefix} Rewriting failed.`);
        }
    }
};
