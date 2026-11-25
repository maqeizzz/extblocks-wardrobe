import { download, getFileText } from '../../../../../../utils.js';
import { 
    templates_path, 
    ElementTemplate, 
    BlockType, 
    MessageRole, 
    ContextType,
    RewriteMode
} from '../../core/constants.js';
import { EditorService } from '../../services/EditorService.js';
import { BlockService } from '../../services/BlockService.js';
import { interactiveSortData } from '../../utils/uiUtils.js';
import { searchReplaceDiffTemplate } from '../../utils/searchReplaceDiffUtils.js';
import { MainUI } from '../MainUI.js';
import { CharacterLibraryEditor } from './CharacterLibraryEditor.js';
import { collectSharedOutfitChoices, isContextItemDisabled, setContextItemDisabled } from '../../utils/characterLibrary.js';

const { 
    callPopup, 
    characters, 
    extensionSettings, 
    renderExtensionTemplateAsync, 
    uuidv4,
} = SillyTavern.getContext();

export const GeneratedEditor = {
    /**
     * Opens the editor for a Generated or Rewrite block.
     * @param {string|null} existingId - The ID of the block to edit, or null for a new block.
     * @param {boolean} isScoped - Whether the block is character-scoped.
     */
    async open(existingId, isScoped) {
        const editorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.GENERATED_EDITOR));
        const contextItemTemplate = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.CONTEXT_ITEM));
        const array = (isScoped ? characters[SillyTavern.getContext().characterId]?.data?.extensions?.ExtBlocks : extensionSettings.ExtBlocks.sets[extensionSettings.ExtBlocks.active_set_idx].global_blocks) ?? [];
        
        let contextItems = [];
        let editingContextItemId = null;
        let isResettingType = false;
        let blockApiPreset = 'big';
        let fullTextTemplate = '';
        const characterLibrary = new CharacterLibraryEditor(editorHtml.find('.ExtBlocks-character-library'), uuidv4, {
            sharedChoices: () => collectSharedOutfitChoices(extensionSettings.ExtBlocks, SillyTavern.getContext().characters),
        });

        // --- Context Management ---

        const loadContextItems = async () => {
            editorHtml.find('#ExtBlocks-editor-context-list').empty();
            contextItems.forEach((context_item, index) => {
                const contextItemHtml = contextItemTemplate.clone();
                if (!context_item.id) context_item.id = uuidv4();

                contextItemHtml.attr('id', context_item.id);
                contextItemHtml.find('.ExtBlocks_editor_context_item_name').text(context_item.name);
                
                const $checkbox = contextItemHtml.find('.disable_ExtBlocks');
                $checkbox.prop('checked', isContextItemDisabled(context_item));

                $checkbox.on('change', function () {
                    setContextItemDisabled(context_item, !!$(this).prop('checked'));
                });

                contextItemHtml.find('.ExtBlocks-toggle-on, .ExtBlocks-toggle-off').on('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    $checkbox.prop('checked', !$checkbox.prop('checked')).trigger('change');
                });

                contextItemHtml.find('.edit_context_item').on('click', () => {
                    editingContextItemId = context_item.id;
                    loadContextItemForEditing(context_item);
                });

                contextItemHtml.find('.delete_context_item').on('click', async () => {
                    if (editingContextItemId === context_item.id) exitEditMode();
                    contextItems.splice(index, 1);
                    await loadContextItems();
                });

                editorHtml.find('#ExtBlocks-editor-context-list').append(contextItemHtml);
            });
        };

        const updateContextItemFieldsVisibility = (type) => {
            characterLibrary.container.toggle(type === ContextType.CHARACTERS);
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages, #ExtBlocks-editor-context-builder-messages, #ExtBlocks-editor-context-builder-block, #ExtBlocks-editor-context-builder-text, #ExtBlocks-editor-context-builder-lastmessagesbyblock').hide();

            if (type === ContextType.TEXT) editorHtml.find('#ExtBlocks-editor-context-builder-text').show();
            else if (type === ContextType.LAST_MESSAGES) editorHtml.find('#ExtBlocks-editor-context-builder-messages').show();
            else if (type === ContextType.PREVIOUS_BLOCK) editorHtml.find('#ExtBlocks-editor-context-builder-block').show();
            else if (type === ContextType.LAST_MESSAGES_KEYWORD) editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').show();
            else if (type === ContextType.LAST_MESSAGES_BY_BLOCK) editorHtml.find('#ExtBlocks-editor-context-builder-lastmessagesbyblock').show();
        };

        const loadContextItemForEditing = (context_item) => {
            characterLibrary.load(context_item.library, context_item.library?.characters?.length === 1);
            editorHtml.find('.ExtBlocks-editor-context-builder-name').val(context_item.name);
            editorHtml.find('select[name="ExtBlocks-editor-context-builder-role"]').val(context_item.role ?? MessageRole.USER);

            isResettingType = true;
            editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val(context_item.type).trigger('change');
            isResettingType = false;
            updateContextItemFieldsVisibility(context_item.type);

            if (context_item.type === ContextType.TEXT) {
                editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val(context_item.text);
            } else if (context_item.type === ContextType.LAST_MESSAGES) {
                editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val(context_item.messages_count);
                editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-offset"]').val(context_item.messages_offset ?? 0);
                editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val(context_item.messages_separator);
                editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val(context_item.user_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val(context_item.user_suffix);
                editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val(context_item.char_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val(context_item.char_suffix);
            } else if (context_item.type === ContextType.LAST_MESSAGES_KEYWORD) {
                editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val(context_item.keyword_stopper);
                editorHtml.find('select[name="ExtBlocks-editor-context-builder-keywordmessages-separator"]').val(context_item.messages_separator);
                editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-userprefix').val(context_item.user_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-usersuffix').val(context_item.user_suffix);
                editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charprefix').val(context_item.char_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charsuffix').val(context_item.char_suffix);
            } else if (context_item.type === ContextType.LAST_MESSAGES_BY_BLOCK) {
                editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-blockname').val(context_item.block_name);
                editorHtml.find('select[name="ExtBlocks-editor-context-builder-lastmessagesbyblock-separator"]').val(context_item.messages_separator);
                editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-userprefix').val(context_item.user_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-usersuffix').val(context_item.user_suffix);
                editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-charprefix').val(context_item.char_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-charsuffix').val(context_item.char_suffix);
            } else if (context_item.type === ContextType.PREVIOUS_BLOCK) {
                editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val(context_item.block_name);
                editorHtml.find('input[name="ExtBlocks-editor-context-builder-block-count"]').val(context_item.block_count ?? 1);
            }

            editorHtml.find('#ExtBlocks-editor-context-editor-empty').hide();
            editorHtml.find('#ExtBlocks-editor-context-editor-fields').show();
        };

        const exitEditMode = (context_type = 'text') => {
            characterLibrary.load();
            editingContextItemId = null;
            editorHtml.find('.ExtBlocks-editor-context-builder-name').val('');
            editorHtml.find('select[name="ExtBlocks-editor-context-builder-role"]').val(MessageRole.USER);
            editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val('');
            editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val('');
            editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-offset"]').val('');
            editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val('double_newline');
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val('');
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val('');
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val('');
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val('');
            editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val('');
            editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-blockname').val('');
            editorHtml.find('select[name="ExtBlocks-editor-context-builder-lastmessagesbyblock-separator"]').val('double_newline');
            editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-userprefix').val('');
            editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-usersuffix').val('');
            editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-charprefix').val('');
            editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-charsuffix').val('');
            editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val('');
            editorHtml.find('input[name="ExtBlocks-editor-context-builder-block-count"]').val('1');

            isResettingType = true;
            editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val(context_type).trigger('change');
            isResettingType = false;

            editorHtml.find('#ExtBlocks-editor-context-editor-empty').show();
            editorHtml.find('#ExtBlocks-editor-context-editor-fields').hide();
        };

        const handleContextItemTypeChange = () => {
            if (isResettingType) return;
            const value = editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val();

            updateContextItemFieldsVisibility(value);
            
            const defaults = EditorService.createContextItem(value);

            if (value === ContextType.TEXT) {
                editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val(defaults.text);
            } else if (value === ContextType.LAST_MESSAGES) {
                editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val(defaults.messages_count);
                editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-offset"]').val(defaults.messages_offset);
                editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val(defaults.messages_separator);
                editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val(defaults.user_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val(defaults.user_suffix);
                editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val(defaults.char_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val(defaults.char_suffix);
            } else if (value === ContextType.LAST_MESSAGES_KEYWORD) {
                editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val(defaults.keyword_stopper);
                editorHtml.find('select[name="ExtBlocks-editor-context-builder-keywordmessages-separator"]').val(defaults.messages_separator);
                editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-userprefix').val(defaults.user_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-usersuffix').val(defaults.user_suffix);
                editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charprefix').val(defaults.char_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charsuffix').val(defaults.char_suffix);
            } else if (value === ContextType.LAST_MESSAGES_BY_BLOCK) {
                editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-blockname').val(defaults.block_name);
                editorHtml.find('select[name="ExtBlocks-editor-context-builder-lastmessagesbyblock-separator"]').val(defaults.messages_separator);
                editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-userprefix').val(defaults.user_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-usersuffix').val(defaults.user_suffix);
                editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-charprefix').val(defaults.char_prefix);
                editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-charsuffix').val(defaults.char_suffix);
            } else if (value === ContextType.PREVIOUS_BLOCK) {
                editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val(defaults.block_name);
                editorHtml.find('input[name="ExtBlocks-editor-context-builder-block-count"]').val(defaults.block_count);
            }
        };

        const getContextItemFromUI = (id) => {
            const name = String(editorHtml.find('.ExtBlocks-editor-context-builder-name').val());
            const role = String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-role"]').val()) || MessageRole.USER;
            const type = editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val();
            
            const existingItem = contextItems.find(i => i.id === id);
            const disabled = existingItem ? (existingItem.disabled ?? false) : false;

            const item = { id, name, role, type, disabled };

            if (type === ContextType.CHARACTERS) {
                item.library = characterLibrary.library;
                if (item.library.characters.length === 1) {
                    // The list owns the toggle. The item editor edits character data.
                    setContextItemDisabled(item, existingItem?.library?.characters?.length === 1
                        ? isContextItemDisabled(existingItem)
                        : isContextItemDisabled(item));
                }
                if (existingItem?.singleCharacter && item.library.characters.length === 1) item.singleCharacter = true;
            } else if (type === ContextType.TEXT) {
                item.text = String(editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val());
            } else if (type === ContextType.LAST_MESSAGES) {
                item.messages_count = parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val())) || 10;
                item.messages_offset = parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-offset"]').val())) || 0;
                item.messages_separator = String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val());
                item.user_prefix = String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val()).replace(/\\n/g, '\n');
                item.user_suffix = String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val()).replace(/\\n/g, '\n');
                item.char_prefix = String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val()).replace(/\\n/g, '\n');
                item.char_suffix = String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val()).replace(/\\n/g, '\n');
            } else if (type === ContextType.LAST_MESSAGES_KEYWORD) {
                item.keyword_stopper = String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val()) || '';
                item.messages_separator = String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-keywordmessages-separator"]').val());
                item.user_prefix = String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-userprefix').val()).replace(/\\n/g, '\n');
                item.user_suffix = String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-usersuffix').val()).replace(/\\n/g, '\n');
                item.char_prefix = String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charprefix').val()).replace(/\\n/g, '\n');
                item.char_suffix = String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charsuffix').val()).replace(/\\n/g, '\n');
            } else if (type === ContextType.LAST_MESSAGES_BY_BLOCK) {
                item.block_name = String(editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-blockname').val()) || '';
                item.messages_separator = String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-lastmessagesbyblock-separator"]').val());
                item.user_prefix = String(editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-userprefix').val()).replace(/\\n/g, '\n');
                item.user_suffix = String(editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-usersuffix').val()).replace(/\\n/g, '\n');
                item.char_prefix = String(editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-charprefix').val()).replace(/\\n/g, '\n');
                item.char_suffix = String(editorHtml.find('.ExtBlocks-editor-context-builder-lastmessagesbyblock-charsuffix').val()).replace(/\\n/g, '\n');
            } else if (type === ContextType.PREVIOUS_BLOCK) {
                item.block_name = String(editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val());
                item.block_count = parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-block-count"]').val())) || 1;
            }

            return item;
        };

        // --- Block Logic ---

        const changeTriggerPeriodicity = (trigger_periodicity) => {
            if (trigger_periodicity === "keyword") {
                editorHtml.find('.Extblocks-editor-period-wrapper').hide();
                editorHtml.find('.Extblocks-editor-keyword-wrapper').show();
            } else {
                editorHtml.find('.Extblocks-editor-period-wrapper').show();
                editorHtml.find('.Extblocks-editor-keyword-wrapper').hide();
            }
        };

        const handleBlockTypeChange = (blockType) => {
            const hideDisplayWrapper = editorHtml.find('#ExtBlocks-editor-hide-display-wrapper');
            const injectBlockWrapper = editorHtml.find('#ExtBlocks-editor-inject-block-wrapper');
            const injectSettings = editorHtml.find('#ExtBlocks-editor-inject-settings');
            const generationOrderWrapper = editorHtml.find('#ExtBlocks-editor-generation-order-wrapper');
            const rewriteModeWrapper = editorHtml.find('#ExtBlocks-editor-rewrite-mode-wrapper');
        
            if (blockType === BlockType.REWRITE) {
                injectSettings.hide();
                hideDisplayWrapper.hide();
                injectBlockWrapper.hide();
                generationOrderWrapper.show();
                rewriteModeWrapper.show();
            } else {
                injectSettings.show();
                hideDisplayWrapper.show();
                injectBlockWrapper.show();
                generationOrderWrapper.hide();
                rewriteModeWrapper.hide();
            }
        };

        const handleRewriteModeChange = (rewriteMode) => {
            const templateField = editorHtml.find('.ExtBlocks-editor-block-template');
            const isSearchReplace = rewriteMode === RewriteMode.SEARCH_REPLACE;

            if (isSearchReplace) {
                if (!templateField.prop('disabled')) {
                    fullTextTemplate = String(templateField.val() ?? '');
                }
                templateField
                    .val(searchReplaceDiffTemplate)
                    .prop('disabled', true)
                    .attr('placeholder', '')
                    .attr('title', 'The Search/Replace output template is enforced automatically. The saved full-text template will be restored when switching back.');
            } else {
                if (templateField.prop('disabled')) {
                    templateField.val(fullTextTemplate);
                }
                templateField
                    .prop('disabled', false)
                    .attr('placeholder', 'Template for the block.')
                    .attr('title', '');
            }
        };

        const handleGenerationPauseChange = () => {
            const isPaused = editorHtml.find('input[name="generation_pause"]').is(':checked');
            editorHtml.find('input[name="user_message"]').prop('disabled', isPaused);
            editorHtml.find('input[name="char_message"]').prop('disabled', isPaused);

            if (isPaused) {
                editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val('keyword').trigger('change');
            }
            editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).prop('disabled', isPaused);
        };

        // --- Initialization ---

        if (existingId) {
            const block = array.find((b) => b.id === existingId);
            if (block) {
                contextItems = structuredClone(block.context || []);
                blockApiPreset = block.api_preset || 'big';
                fullTextTemplate = String(block.template ?? '');
                
                editorHtml.find('.ExtBlocks-editor-block-name').val(block.name);
                editorHtml.find(`select[name="ExtBlocks-editor-block-type"]`).val(block.block_type ?? BlockType.GENERATED);
                editorHtml.find('.ExtBlocks-editor-block-template').val(fullTextTemplate);
                editorHtml.find('.ExtBlocks-editor-block-prompt').val(block.prompt ?? '');
                editorHtml.find('input[name="user_message"]').prop('checked', block.user_message ?? false);
                editorHtml.find('input[name="char_message"]').prop('checked', block.char_message ?? true);
                editorHtml.find('input[name="generation_pause"]').prop('checked', block.generation_pause ?? false);
                
                const trigger_periodicity = (block.keyword && block.keyword !== '') ? "keyword" : "periodic";
                editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val(trigger_periodicity);
                editorHtml.find('input[name="period"]').val(block.period ?? 2);
                editorHtml.find('input[name="keyword"]').val(block.keyword ?? '');
                editorHtml.find('input[name="keyword_is_regex"]').prop('checked', block.keyword_is_regex ?? false);
                
                editorHtml.find('input[name="hide_display"]').prop('checked', block.hide_display ?? false);
                editorHtml.find('input[name="inject_block"]').prop('checked', block.inject_block ?? false);
                editorHtml.find('input[name="disabled"]').prop('checked', block.disabled ?? false);
                editorHtml.find('input[name="background"]').prop('checked', block.background ?? false);
                editorHtml.find('input[name="apply_regex"]').prop('checked', block.apply_regex ?? false);
                editorHtml.find(`select[name="ExtBlocks-editor-injection-role"]`).val(block.injection_role ?? 0);
                editorHtml.find(`select[name="ExtBlocks-editor-injection-position"]`).val(block.injection_position ?? 0);
                editorHtml.find('input[name="injection_depth"]').val(block.injection_depth ?? 4);
                editorHtml.find(`select[name="ExtBlocks-editor-generation-order"]`).val(block.generation_order ?? 'before');
                editorHtml.find(`select[name="ExtBlocks-editor-rewrite-mode"]`).val(block.rewrite_mode ?? RewriteMode.FULL);
                
                changeTriggerPeriodicity(trigger_periodicity);
                handleBlockTypeChange(block.block_type ?? BlockType.GENERATED);
            }
        } else {
            editorHtml.find('input[name="disabled"]').prop('checked', false);
            editorHtml.find('input[name="char_message"]').prop('checked', true);
            editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val('periodic');
            editorHtml.find(`select[name="ExtBlocks-editor-rewrite-mode"]`).val(RewriteMode.FULL);
            changeTriggerPeriodicity('periodic');
        }

        // --- Event Listeners ---

        editorHtml.find('#ExtBlocks-editor-context-item-save').on('click', () => {
            if (editingContextItemId === null) return;

            const isNew = editingContextItemId === 'new';
            const id = isNew ? uuidv4() : editingContextItemId;
            const item = getContextItemFromUI(id);

            if (!EditorService.validateContextItem(item)) {
                toastr.error('Could not save context item: Name is required!');
                return;
            }

            if (isNew) {
                contextItems.push(item);
            } else {
                const index = contextItems.findIndex(i => i.id === editingContextItemId);
                if (index !== -1) {
                    contextItems[index] = item;
                }
            }

            loadContextItems();
            exitEditMode();
        });

        editorHtml.find('.ExtBlocks-preset-context-item-add').on('click', () => {
            exitEditMode();
            editorHtml.find('#ExtBlocks-editor-context-editor-empty').hide();
            editorHtml.find('#ExtBlocks-editor-context-editor-fields').show();
            editingContextItemId = 'new';
        });

        editorHtml.find('#ExtBlocks-editor-context-item-exit').on('click', () => exitEditMode());

        editorHtml.find('.ExtBlocks-editor-tab').on('click', function () {
            const tab = $(this).data('tab');
            editorHtml.find('.ExtBlocks-editor-tab').removeClass('active');
            $(this).addClass('active');
            editorHtml.find('.ExtBlocks-editor-tab-content').hide();
            editorHtml.find(`#ExtBlocks-editor-tab-${tab}`).show();
        });
        editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).on('change', handleContextItemTypeChange);
        editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).on('change', (e) => changeTriggerPeriodicity($(e.target).val()));
        editorHtml.find(`select[name="ExtBlocks-editor-block-type"]`).on('change', (e) => {
            const blockType = $(e.target).val();
            handleBlockTypeChange(blockType);
            handleRewriteModeChange(
                blockType === BlockType.REWRITE
                    ? editorHtml.find(`select[name="ExtBlocks-editor-rewrite-mode"]`).val()
                    : RewriteMode.FULL,
            );
        });
        editorHtml.find(`select[name="ExtBlocks-editor-rewrite-mode"]`).on('change', (e) => handleRewriteModeChange($(e.target).val()));
        editorHtml.find('input[name="generation_pause"]').on('change', handleGenerationPauseChange);
        
        editorHtml.find('#ExtBlocks-editor-context-import').on('click', () => editorHtml.find('#ExtBlocks-editor-context-importFile').trigger('click'));
        editorHtml.find('#ExtBlocks-editor-context-importFile').on('change', async function () {
            for (const file of this.files) {
                try {
                    const fileText = await getFileText(file);
                    const items = JSON.parse(fileText).items;
                    if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
                        throw new Error('Invalid context items');
                    }
                    exitEditMode();
                    contextItems = items;
                    await loadContextItems();
                } catch (e) { toastr.error('Invalid JSON file.'); }
            }
            this.value = '';
        });

        editorHtml.find('#ExtBlocks-editor-context-export').on('click', () => {
            download(JSON.stringify({ items: contextItems }, null, 4), 'context.json', 'application/json');
        });

        handleGenerationPauseChange();
        handleRewriteModeChange(editorHtml.find(`select[name="ExtBlocks-editor-rewrite-mode"]`).val());
        await loadContextItems();
        await interactiveSortData([{
            selector: editorHtml.find('#ExtBlocks-editor-context-list'),
            setter: (x) => {
                contextItems = x;
                loadContextItems();
            },
            getter: () => contextItems,
        }]);

        const popupResult = await callPopup(editorHtml, 'confirm', undefined, { okButton: 'Save', wide: true });
        if (popupResult) {
            const trigger_periodicity = editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val();
            const blockType = editorHtml.find(`select[name="ExtBlocks-editor-block-type"]`).val();
            const rewriteMode = editorHtml.find(`select[name="ExtBlocks-editor-rewrite-mode"]`).val();
            const template = blockType === BlockType.REWRITE && rewriteMode === RewriteMode.SEARCH_REPLACE
                ? fullTextTemplate
                : editorHtml.find('.ExtBlocks-editor-block-template').val();
            const blockData = {
                id: existingId,
                block_type: blockType,
                name: editorHtml.find('.ExtBlocks-editor-block-name').val(),
                disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
                template: template,
                prompt: editorHtml.find('.ExtBlocks-editor-block-prompt').val(),
                user_message: editorHtml.find('input[name="user_message"]').prop('checked'),
                char_message: editorHtml.find('input[name="char_message"]').prop('checked'),
                generation_pause: editorHtml.find('input[name="generation_pause"]').prop('checked'),
                period: editorHtml.find('input[name="period"]').val(),
                keyword: trigger_periodicity === 'keyword' ? editorHtml.find('input[name="keyword"]').val() : '',
                keyword_is_regex: editorHtml.find('input[name="keyword_is_regex"]').prop('checked'),
                hide_display: editorHtml.find('input[name="hide_display"]').prop('checked'),
                inject_block: editorHtml.find('input[name="inject_block"]').prop('checked'),
                injection_role: editorHtml.find(`select[name="ExtBlocks-editor-injection-role"]`).val(),
                injection_position: editorHtml.find(`select[name="ExtBlocks-editor-injection-position"]`).val(),
                injection_depth: editorHtml.find('input[name="injection_depth"]').val(),
                generation_order: editorHtml.find(`select[name="ExtBlocks-editor-generation-order"]`).val(),
                rewrite_mode: rewriteMode,
                background: editorHtml.find('input[name="background"]').prop('checked'),
                apply_regex: editorHtml.find('input[name="apply_regex"]').prop('checked'),
                context: contextItems,
                api_preset: blockApiPreset
            };

            const preparedBlock = EditorService.prepareBlockForSave(blockData);
            await BlockService.saveBlock(preparedBlock, isScoped);
            await MainUI.loadBlocks();
        }
    }
};
