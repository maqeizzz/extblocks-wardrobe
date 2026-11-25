import { BlockService } from '../services/BlockService.js';
import { BlockType, ContextType, MessageRole } from '../core/constants.js';
import { CharacterLibraryEditor } from './editors/CharacterLibraryEditor.js';

const { callGenericPopup, POPUP_TYPE, uuidv4 } = SillyTavern.getContext();
let popupOpen = false;

function action(label, icon, handler) {
    return $('<button>', { type: 'button', class: 'menu_button ExtBlocks-quick-action' })
        .append($('<i>', { class: `fa-solid ${icon}`, 'aria-hidden': 'true' }), $('<span>').text(label))
        .on('click', handler);
}

export const CharacterLibraryMenu = {
    init() {
        const id = 'ExtBlocks-quick-menu';
        if (document.getElementById(id)) return;
        $('#extensionsMenu').append($('<div>', { id, class: 'list-group-item flex-container flexGap5 interactable', role: 'button', tabindex: 0 })
            .append($('<i>', { class: 'fa-solid fa-user-tag', 'aria-hidden': 'true' }), $('<span>').text('ExtBlocks'))
            .on('click', () => void this.open())
            .on('keydown', event => {
                if (!['Enter', ' '].includes(event.key)) return;
                event.preventDefault();
                event.currentTarget.click();
            }));
    },

    async open() {
        if (popupOpen) return;
        popupOpen = true;
        try {
            const { characterId, characters } = SillyTavern.getContext();
            const card = characters[characterId];
            const embedded = card?.data?.extensions?.ExtBlocks ?? [];
            const blocks = BlockService.getBlocksByType([BlockType.GENERATED, BlockType.REWRITE]);
            const libraries = blocks.flatMap(block => {
                const items = (Array.isArray(block.context) ? block.context : []).filter(item => item?.type === ContextType.CHARACTERS);
                return (items.length ? items : [{
                    id: uuidv4(), name: 'Characters & wardrobe', type: ContextType.CHARACTERS, role: MessageRole.USER,
                }]).map(item => ({ block, item, scoped: embedded.includes(block), multiple: items.length > 1 }));
            });

            const popup = $('<div>', { class: 'ExtBlocks-quick-library' }).append($('<h3>').text('ExtBlocks'));
            let saving = false;
            if (!libraries.length) {
                popup.append($('<p>').text('Create or import a Generated or Rewrite block to use character prompts.'));
            } else {
                let mode = 'characters';
                const panel = $('<div>', { class: 'ExtBlocks-character-library ExtBlocks-quick-list' });
                const status = $('<div>', { role: 'status', class: 'ExtBlocks-quick-status' });
                const search = $('<input>', { type: 'search', class: 'text_pole', 'aria-label': 'Search characters' });
                const empty = $('<p>', { class: 'ExtBlocks-quick-empty' });
                const destination = $('<select>', { class: 'text_pole', 'aria-label': 'Add to block' });
                const editors = [];
                const tabs = $('<div>', { class: 'ExtBlocks-quick-tabs', role: 'group', 'aria-label': 'ExtBlocks sections' });
                const showList = () => {
                    const query = String(search.val()).trim().toLowerCase();
                    const viewingCharacters = mode === 'characters';
                    let visibleCount = 0;
                    panel.attr('data-mode', mode);
                    tabs.children().each((_, tab) => {
                        $(tab).attr('aria-pressed', String(tab.dataset.mode === mode));
                    });
                    for (const { container } of editors) {
                        const cards = container.find(viewingCharacters ? '.ExtBlocks-character-card' : '.ExtBlocks-outfit-card');
                        let count = 0;
                        cards.each((_, entry) => {
                            const summary = viewingCharacters ? $(entry).children('details').children('summary') : $(entry).children('summary');
                            const matches = summary.text().toLowerCase().includes(query);
                            $(entry).toggle(matches);
                            if (matches) count++;
                        });
                        container.toggle(count > 0);
                        visibleCount += count;
                    }
                    empty.text(query ? 'No matches.' : viewingCharacters ? 'No characters yet.' : 'No outfits yet.').toggle(!visibleCount);
                };
                for (const [key, label, icon] of [['characters', 'Characters', 'fa-user'], ['wardrobe', 'Wardrobe', 'fa-shirt']]) {
                    tabs.append(action(label, icon, () => {
                        mode = key;
                        search.val('').attr('aria-label', `Search ${key}`).attr('placeholder', `Search ${key}`);
                        addLabel.text(key === 'characters' ? 'Add character' : 'Add outfit');
                        showList();
                    }).attr('data-mode', key));
                }
                search.attr('placeholder', 'Search characters').on('input', showList);

                for (const [index, { block, item, scoped, multiple }] of libraries.entries()) {
                    const label = multiple ? `${block.name} · ${item.name}` : block.name;
                    destination.append(new Option(`${label} (${scoped ? 'Character card' : 'Preset'})`, String(index)));
                    const container = $('<section>', { class: 'ExtBlocks-quick-group' });
                    const caption = $('<div>', { class: 'ExtBlocks-quick-caption' });
                    if (libraries.length > 1) caption.append($('<span>').text(label));
                    const body = $('<div>');
                    const disabledBlock = action('Enable block', 'fa-power-off', () => void save(editor.library, true));
                    caption.append(disabledBlock.toggle(Boolean(block.disabled)));
                    const save = async (library, enableBlock = false) => {
                        const previousLibrary = item.library;
                        const previousItemDisabled = item.disabled;
                        const previousContext = block.context;
                        const previousBlockDisabled = block.disabled;
                        saving = true;
                        popup.prop('inert', true);
                        status.text('Applying…');
                        try {
                            const current = SillyTavern.getContext();
                            if ((scoped && current.characters[current.characterId] !== card) || !BlockService.getAllBlocks().includes(block)) {
                                throw new Error('The original block is no longer active.');
                            }
                            const context = Array.isArray(block.context) ? block.context : [];
                            if (!context.includes(item)) {
                                if (previousLibrary !== undefined) throw new Error('The original library is no longer active.');
                                block.context = [...context, item];
                            }
                            item.library = structuredClone(library);
                            if (!editor.itemDisabled && previousItemDisabled) item.disabled = false;
                            if (enableBlock) block.disabled = false;
                            await BlockService.saveBlock(block, scoped);
                            disabledBlock.toggle(Boolean(block.disabled));
                            status.text(block.disabled ? 'Saved. This block is off.' : 'Changes applied');
                        } catch (error) {
                            item.library = previousLibrary;
                            item.disabled = previousItemDisabled;
                            block.context = previousContext;
                            block.disabled = previousBlockDisabled;
                            editor.itemDisabled = Boolean(previousItemDisabled);
                            editor.load(previousLibrary);
                            status.text('Changes could not be saved. Reopen the window and try again.');
                            console.error('[ExtBlocks] Could not save library:', error);
                        } finally {
                            saving = false;
                            popup.prop('inert', false);
                        }
                    };
                    const editor = new CharacterLibraryEditor(body, uuidv4, {
                        save,
                        itemDisabled: Boolean(item.disabled),
                        onRender: showList,
                    });
                    editors.push({ editor, container });
                    panel.append(container.append(caption, body));
                    editor.load(item.library);
                }

                const add = action('Add character', 'fa-plus', () => {
                    search.val('');
                    const { editor } = editors[Number(destination.val())];
                    editor.addEntry(mode);
                });
                const addLabel = add.children('span');
                const toolbar = $('<div>', { class: 'ExtBlocks-quick-toolbar' }).append(search, destination.toggle(libraries.length > 1), add);
                popup.append(tabs, toolbar, status, panel, empty);
                showList();
            }

            await callGenericPopup(popup, POPUP_TYPE.TEXT, '', {
                large: true, wide: true, allowVerticalScrolling: true, leftAlign: true, okButton: 'Close',
                onClosing: () => !saving,
            });
        } catch (error) {
            console.error('[ExtBlocks] Could not open library:', error);
            toastr.error('[ExtBlocks] Could not open the character library.');
        } finally {
            popupOpen = false;
        }
    },
};
