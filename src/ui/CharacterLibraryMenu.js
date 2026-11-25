import { BlockService } from '../services/BlockService.js';
import { ContextType } from '../core/constants.js';
import { CharacterLibraryEditor } from './editors/CharacterLibraryEditor.js';

const { callGenericPopup, POPUP_TYPE, uuidv4 } = SillyTavern.getContext();
let popupOpen = false;

export const CharacterLibraryMenu = {
    init() {
        const menu = $('#extensionsMenu');
        for (const [mode, label, icon] of [
            ['characters', 'Characters', 'fa-user'],
            ['wardrobe', 'Wardrobe', 'fa-shirt'],
        ]) {
            const id = `ExtBlocks-quick-${mode}`;
            if (document.getElementById(id)) continue;
            menu.append($('<div>', { id, class: 'list-group-item flex-container flexGap5 interactable', role: 'button', tabindex: 0 })
                .append($('<i>', { class: `fa-solid ${icon}`, 'aria-hidden': 'true' }), $('<span>').text(`ExtBlocks · ${label}`))
                .on('click', () => void this.open(mode, label))
                .on('keydown', event => {
                    if (!['Enter', ' '].includes(event.key)) return;
                    event.preventDefault();
                    event.currentTarget.click();
                }));
        }
    },

    async open(mode, label) {
        if (popupOpen) return;
        popupOpen = true;
        try {
            const { characterId, characters } = SillyTavern.getContext();
            const card = characters[characterId];
            const embedded = card?.data?.extensions?.ExtBlocks ?? [];
            const libraries = BlockService.getAllBlocks().flatMap(block =>
                (Array.isArray(block.context) ? block.context : [])
                    .filter(item => item?.type === ContextType.CHARACTERS)
                    .map(item => ({ block, item, scoped: embedded.includes(block) })));
            const popup = $('<div>', { class: 'ExtBlocks-quick-library' }).append($('<h3>').text(label));
            let saving = false;
            if (libraries.length === 0) {
                popup.append($('<p>').text('Add or import a Characters & wardrobe item in the Context Builder of a block in the active preset or character card.'));
            } else {
                const picker = $('<select>', { class: 'text_pole wide100p' });
                const panel = $('<div>', { class: 'ExtBlocks-character-library' });
                const status = $('<div>', { role: 'status', class: 'ExtBlocks-quick-status' });
                const editors = new Map();
                for (const [index, { block, item, scoped }] of libraries.entries()) {
                    const scope = scoped ? 'Character card' : 'Preset';
                    picker.append(new Option(`${block.name} / ${item.name || 'Characters & wardrobe'} (${scope})${block.disabled || item.disabled ? ' · disabled' : ''}`, String(index)));
                }
                const selectLibrary = () => {
                    const index = Number(picker.val());
                    const { block, item, scoped } = libraries[index];
                    panel.children().detach();
                    status.empty();
                    if (!editors.has(index)) {
                        const editor = new CharacterLibraryEditor($('<div>'), uuidv4, {
                            mode,
                            save: async library => {
                                const previous = item.library;
                                saving = true;
                                picker.prop('disabled', true);
                                panel.prop('inert', true);
                                status.text('Applying…');
                                try {
                                    const current = SillyTavern.getContext();
                                    if ((scoped && current.characters[current.characterId] !== card)
                                        || !BlockService.getAllBlocks().includes(block)
                                        || !block.context.includes(item)) {
                                        throw new Error('The original library is no longer active.');
                                    }
                                    item.library = structuredClone(library);
                                    await BlockService.saveBlock(block, scoped);
                                    status.text('Changes applied');
                                } catch (error) {
                                    item.library = previous;
                                    editor.load(previous);
                                    status.text('Changes could not be saved. Reopen the library and try again.');
                                    console.error('[ExtBlocks] Could not save library:', error);
                                } finally {
                                    saving = false;
                                    picker.prop('disabled', false);
                                    panel.prop('inert', false);
                                }
                            },
                        });
                        editors.set(index, editor);
                        editor.load(item.library);
                    }
                    panel.append(editors.get(index).container);
                };
                const libraryLabel = $('<label>').append($('<span>').text('Block and library'), picker);
                popup.append(libraryLabel, status, panel);
                picker.on('change', selectLibrary);
                selectLibrary();
            }
            await callGenericPopup(popup, POPUP_TYPE.TEXT, '', {
                large: true,
                wide: true,
                allowVerticalScrolling: true,
                leftAlign: true,
                okButton: 'Close',
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
