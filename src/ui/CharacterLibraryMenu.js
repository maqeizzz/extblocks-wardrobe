import { BlockService } from '../services/BlockService.js';
import { CharacterLibraryEditor } from './editors/CharacterLibraryEditor.js';
import { collectSharedOutfitChoices, isContextItemDisabled, readCharacterLibrary, setContextItemDisabled, splitCharacterContext } from '../utils/characterLibrary.js';
import { BlockType, ContextType, MessageRole } from '../core/constants.js';
import { SettingsService } from '../services/SettingsService.js';

const { callGenericPopup, POPUP_TYPE, uuidv4, extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
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
            const settings = extensionSettings.ExtBlocks;
            const { characterId, characters } = SillyTavern.getContext();
            const card = characters[characterId];
            const embedded = card?.data?.extensions?.ExtBlocks ?? [];
            const supported = block => [BlockType.GENERATED, BlockType.REWRITE].includes(block.block_type ?? BlockType.GENERATED);
            const targets = settings.sets.flatMap((set, setIndex) => (set.global_blocks ?? [])
                .filter(block => supported(block) && !embedded.some(entry => entry.name === block.name))
                .map(block => ({ block, set, setIndex })));
            targets.push(...embedded.filter(supported).map(block => ({ block })));
            const popup = $('<div>', { class: 'ExtBlocks-quick-library ExtBlocks-quick-library-v5' });
            const panel = $('<div>', { class: 'ExtBlocks-character-library ExtBlocks-quick-list' });
            const tabs = $('<div>', { class: 'ExtBlocks-quick-tabs', role: 'group', 'aria-label': 'ExtBlocks sections' });
            const search = $('<input>', { type: 'search', class: 'text_pole' });
            const status = $('<div>', { role: 'status', class: 'ExtBlocks-quick-status' });
            const picker = $('<select>', { class: 'text_pole', 'aria-label': 'Block preset' });
            const empty = $('<p>', { class: 'ExtBlocks-quick-empty' });
            const inheritedOutfits = $('<div>');
            const cached = new Map();
            let mode = 'characters';
            let selected = targets.findIndex(target => target.setIndex === settings.active_set_idx);
            selected = selected < 0 ? 0 : selected;
            let saving = false;

            if (settings.characterCatalog && !settings.restoredCatalogWardrobe) {
                const outfits = readCharacterLibrary({ outfits: settings.sharedWardrobe }).outfits;
                const shared = new Map(outfits.map(outfit => [outfit.id, outfit]));
                const formerlyLocal = new Set((settings.characterCatalog.importedOutfits ?? []).map(([, id]) => id));
                for (const outfit of readCharacterLibrary(settings.characterCatalog).outfits) {
                    if (outfit.ownerId || formerlyLocal.has(outfit.id)) continue;
                    const id = outfit.id.replace(/^shared:/, '');
                    if (id) shared.set(id, { ...outfit, id });
                }
                settings.sharedWardrobe = [...shared.values()];
                settings.restoredCatalogWardrobe = true;
                saveSettingsDebounced();
            }

            targets.forEach(({ block, set }, index) => {
                const duplicate = targets.some((target, other) => other !== index && target.block.name === block.name);
                const label = duplicate ? `${block.name} · ${set?.name ?? 'Character card'}` : block.name;
                picker.append(new Option(label, String(index)));
            });
            picker.val(String(selected)).prop('disabled', !targets.length);

            const sharedChoices = () => collectSharedOutfitChoices(settings, SillyTavern.getContext().characters);
            const showList = () => {
                const query = String(search.val()).trim().toLowerCase();
                panel.attr('data-mode', mode);
                if (mode === 'wardrobe') {
                    const context = targets[selected]?.block.context;
                    const items = Array.isArray(context) ? context : [];
                    const localIds = new Set(items.flatMap(item => readCharacterLibrary(item?.library).outfits.map(outfit => outfit.id)));
                    inheritedOutfits.empty();
                    for (const outfit of sharedChoices()) {
                        if (outfit.source === undefined || localIds.has(outfit.id)) continue;
                        inheritedOutfits.append($('<details>', { class: 'ExtBlocks-outfit-card' }).append(
                            $('<summary>').text(outfit.name || 'Unnamed outfit'),
                            $('<p>').text(outfit.tags),
                            $('<small>').text(`Edit in ${outfit.source || 'the original block'}`),
                        ));
                    }
                }
                tabs.children().each((_, tab) => $(tab).attr('aria-pressed', String(tab.dataset.mode === mode)));
                const selector = mode === 'characters' ? '.ExtBlocks-character-card' : '.ExtBlocks-outfit-card';
                let matches = 0;
                panel.find(selector).each((_, entry) => {
                    const summary = entry.querySelector('summary');
                    const show = summary.textContent.toLowerCase().includes(query);
                    $(entry).toggle(show);
                    if (show) matches++;
                });
                const message = mode === 'characters'
                    ? targets.length ? 'No characters in this block.' : 'Create or import a block first.'
                    : 'No outfits yet.';
                empty.text(query ? 'No matches.' : message).toggle(!matches);
            };
            const shared = new CharacterLibraryEditor($('<div>'), uuidv4, {
                sharedOnly: true,
                onRender: showList,
                save: ({ outfits }) => {
                    settings.sharedWardrobe = structuredClone(outfits);
                    saveSettingsDebounced();
                    for (const editors of cached.values()) {
                        for (const editor of editors) editor.refreshOutfitChoices();
                    }
                    status.text('Shared wardrobe updated');
                    showList();
                },
            });
            shared.load({ outfits: settings.sharedWardrobe });

            const makeEditor = (target, item, attached = true) => {
                const { block, set } = target;
                const save = async (library, split = null) => {
                    if (saving) return;
                    const priorContext = block.context;
                    const priorLibrary = item.library;
                    const priorName = item.name;
                    const wasDisabled = item.disabled;
                    saving = true;
                    popup.prop('inert', true);
                    try {
                        const current = SillyTavern.getContext();
                        const source = set
                            ? settings.sets.includes(set) && set.global_blocks
                            : current.characters[current.characterId] === card && card?.data?.extensions?.ExtBlocks;
                        if (!Array.isArray(source) || !source.includes(block)) throw new Error('Block is no longer available');
                        const context = Array.isArray(block.context) ? block.context : [];
                        if (attached && !context.includes(item)) throw new Error('Library is no longer available');
                        if (!attached) block.context = [...context, item];
                        item.library = structuredClone(library);
                        if (item.library.characters.length === 1) {
                            const [character] = item.library.characters;
                            if (item.singleCharacter) item.name = character.name.trim() || 'Unnamed character';
                            setContextItemDisabled(item, editor.itemDisabled || !character.enabled);
                        } else if (wasDisabled && !editor.itemDisabled) {
                            item.disabled = false;
                        }
                        if (split) {
                            block.context = context.flatMap(entry => entry === item ? [entry, split] : [entry]);
                        }
                        if (set) saveSettingsDebounced();
                        else await BlockService.saveBlock(block, true);
                        attached = true;
                        if (item.library.characters.length === 1) editor.itemDisabled = isContextItemDisabled(item);
                        if (split) {
                            editor.load(item.library);
                            const editors = cached.get(target);
                            editors.splice(editors.indexOf(editor) + 1, 0, makeEditor(target, split));
                            render();
                        }
                        for (const editors of cached.values()) {
                            for (const other of editors) other.refreshOutfitChoices();
                        }
                        showList();
                        status.text(block.disabled ? 'Saved. This block is disabled.' : `Saved to ${block.name}`);
                    } catch (error) {
                        block.context = priorContext;
                        item.library = priorLibrary;
                        item.name = priorName;
                        item.disabled = wasDisabled;
                        editor.itemDisabled = isContextItemDisabled(item);
                        editor.load(priorLibrary);
                        status.text('Could not save. Reopen ExtBlocks and try again.');
                        console.error('[ExtBlocks] Could not save library:', error);
                    } finally {
                        saving = false;
                        popup.prop('inert', false);
                    }
                };
                const editor = new CharacterLibraryEditor($('<div>'), uuidv4, {
                    itemDisabled: isContextItemDisabled(item),
                    sharedChoices,
                    onRender: showList,
                    save,
                    splitCharacter: (characterId, library) => {
                        const split = splitCharacterContext(item, library, characterId, uuidv4());
                        if (split) void save(split.remainder, split.contextItem);
                    },
                });
                editor.load(item.library);
                return editor;
            };

            const editorsForBlock = target => {
                if (cached.has(target)) return cached.get(target);
                const items = Array.isArray(target.block.context) ? target.block.context : [];
                const editors = items.filter(item => item?.type === ContextType.CHARACTERS).map(item => makeEditor(target, item));
                cached.set(target, editors);
                return editors;
            };

            const add = action('Add character', 'fa-plus', () => {
                search.val('');
                if (mode === 'wardrobe') shared.addEntry(mode);
                else if (targets[selected]) {
                    const target = targets[selected];
                    const item = {
                        id: uuidv4(), type: ContextType.CHARACTERS, name: 'Unnamed character', role: MessageRole.USER,
                        disabled: true, singleCharacter: true,
                    };
                    const editor = makeEditor(target, item, false);
                    editorsForBlock(target).push(editor);
                    editor.addEntry('characters');
                    render();
                }
            });
            const render = () => {
                panel.children().detach();
                const target = targets[selected];
                if (mode === 'wardrobe') {
                    panel.append($('<section>').append($('<h4>').text('Shared wardrobe'), shared.container, inheritedOutfits));
                }
                if (target) {
                    const blockPanel = $('<section>', { class: 'ExtBlocks-quick-block-panel' });
                    if (mode === 'wardrobe') blockPanel.append($('<h4>').text(target.block.name));
                    for (const editor of editorsForBlock(target)) blockPanel.append(editor.container);
                    panel.append(blockPanel);
                }
                const label = mode === 'characters' ? 'Search characters' : 'Search outfits';
                search.attr('aria-label', label).attr('placeholder', label);
                add.prop('disabled', mode === 'characters' && !target);
                add.children('span').text(mode === 'characters' ? 'Add character' : 'Add shared outfit');
                showList();
            };
            picker.on('change', async () => {
                selected = Number(picker.val());
                const target = targets[selected];
                if (!target) return;
                saving = true;
                popup.prop('inert', true);
                try {
                    const index = settings.sets.indexOf(target.set);
                    if (index >= 0 && index !== settings.active_set_idx) await SettingsService.changeSet(index);
                    search.val('');
                    status.text(target.block.disabled ? 'This block is disabled.' : '');
                    render();
                } catch (error) {
                    status.text('Could not switch preset. Reopen ExtBlocks and try again.');
                    console.error('[ExtBlocks] Could not switch preset:', error);
                } finally {
                    saving = false;
                    popup.prop('inert', false);
                }
            });
            for (const [key, label, icon] of [['characters', 'Characters', 'fa-user'], ['wardrobe', 'Wardrobe', 'fa-shirt']]) {
                tabs.append(action(label, icon, () => {
                    mode = key;
                    search.val('');
                    render();
                }).attr('data-mode', key));
            }
            search.on('input', showList);
            const header = $('<header>', { class: 'ExtBlocks-quick-header' }).append(
                $('<h3>').text('ExtBlocks'),
                $('<label>').append($('<span>').text('Block preset'), picker),
            );
            popup.append(header, tabs, $('<div>', { class: 'ExtBlocks-quick-toolbar' }).append(search, add), status, panel, empty);
            if (targets[selected]?.block.disabled) status.text('This block is disabled.');
            render();
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
