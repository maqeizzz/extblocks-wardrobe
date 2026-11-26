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
            const sharedRows = $('<div>', { class: 'ExtBlocks-wardrobe-rows' });
            const personalRows = $('<div>', { class: 'ExtBlocks-wardrobe-rows' });
            const sharedSection = $('<section>', { class: 'ExtBlocks-wardrobe-group' }).append($('<h4>').text('Shared wardrobe'), sharedRows);
            const personalSection = $('<section>', { class: 'ExtBlocks-wardrobe-group' }).append($('<h4>').text('Personal outfits'), personalRows);
            const inheritedOutfits = new Map();
            const ownerGroups = new Map();
            const cached = new Map();
            const favorites = new Set(Array.isArray(settings.quickFavorites) ? settings.quickFavorites : []);
            let favoritesOnly = false;
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
            const filterList = () => {
                const query = String(search.val()).trim().toLowerCase();
                const selector = mode === 'characters' ? '.ExtBlocks-character-card' : '.ExtBlocks-outfit-card';
                let matches = 0;
                panel.find(selector).each((_, entry) => {
                    const summary = entry.querySelector('summary');
                    const label = summary.querySelector('.ExtBlocks-outfit-name');
                    const owner = summary.querySelector('.ExtBlocks-outfit-owner');
                    const text = label ? `${label.textContent} ${owner?.textContent ?? ''}` : summary.textContent;
                    const show = text.trim().toLowerCase().includes(query)
                        && (mode !== 'characters' || !favoritesOnly || entry.dataset.favorite === 'true');
                    $(entry).toggle(show);
                    if (show) matches++;
                });
                if (mode === 'wardrobe') {
                    personalRows.children().each((_, group) => {
                        const show = $(group).find('.ExtBlocks-outfit-card').toArray().some(card => card.style.display !== 'none');
                        $(group).toggle(show);
                        if (query && show) {
                            if (group.dataset.openBeforeSearch === undefined) group.dataset.openBeforeSearch = String(group.open);
                            group.open = true;
                        } else if (group.dataset.openBeforeSearch !== undefined) {
                            group.open = group.dataset.openBeforeSearch === 'true';
                            delete group.dataset.openBeforeSearch;
                        }
                    });
                    for (const [section, rows] of [[sharedSection, sharedRows], [personalSection, personalRows]]) {
                        section.toggle(rows.children().toArray().some(row => row.style.display !== 'none'));
                    }
                }
                const message = mode === 'characters'
                    ? targets.length ? 'No characters in this block.' : 'Create or import a block first.'
                    : 'No outfits yet.';
                empty.text(query ? 'No matches.' : mode === 'characters' && favoritesOnly ? 'No favorite characters in this block.' : message).toggle(!matches);
            };
            const favoriteFilter = action('Favorites', 'fa-star', () => {
                favoritesOnly = !favoritesOnly;
                favoriteFilter.attr('aria-pressed', String(favoritesOnly));
                filterList();
            }).attr('aria-pressed', 'false');

            const showList = () => {
                panel.attr('data-mode', mode);
                tabs.children().each((_, tab) => $(tab).attr('aria-pressed', String(tab.dataset.mode === mode)));
                favoriteFilter.toggle(mode === 'characters');
                if (mode === 'wardrobe') updateWardrobeRows();
                else {
                    const byName = new Map();
                    panel.find('.ExtBlocks-character-card').each((_, row) => {
                        const name = $(row).find('.ExtBlocks-character-name').first().text().trim().toLowerCase();
                        if (!byName.has(name)) byName.set(name, []);
                        byName.get(name).push(row);
                    });
                    for (const rows of byName.values()) {
                        const counts = new Map();
                        for (const row of rows) counts.set(row.dataset.contextLabel, (counts.get(row.dataset.contextLabel) ?? 0) + 1);
                        rows.forEach((row, index) => {
                            const name = $(row).find('.ExtBlocks-character-name').first().text();
                            const contextName = row.dataset.contextLabel;
                            const label = contextName && contextName !== name ? contextName : '';
                            const suffix = counts.get(contextName) > 1 ? `#${index + 1}` : '';
                            $(row).find('.ExtBlocks-character-context').text([label, suffix].filter(Boolean).join(' · '));
                        });
                    }
                }
                filterList();
            };
            const setWardrobeRows = (list, cards) => {
                const rows = new Set(cards);
                const container = list.get(0);
                list.children().each((_, row) => {
                    if (!rows.has(row)) $(row).detach();
                });
                cards.forEach((row, index) => {
                    const next = container.children[index] ?? null;
                    if (next !== row) container.insertBefore(row, next);
                });
            };
            const updateWardrobeRows = () => {
                const target = targets[selected];
                const editors = cached.get(target) ?? [];
                const localIds = new Set(editors.flatMap(editor => editor.library.outfits.map(outfit => outfit.id)));
                const localCards = editors.flatMap(editor => editor.wardrobeCards.toArray());
                const inherited = [];
                for (const outfit of sharedChoices()) {
                    if (outfit.source === undefined || localIds.has(outfit.id)) continue;
                    if (!inheritedOutfits.has(outfit.id)) {
                        inheritedOutfits.set(outfit.id, $('<details>', { class: 'ExtBlocks-outfit-card' }).append(
                            $('<summary>').append($('<span>', { class: 'ExtBlocks-outfit-name' })),
                            $('<p>'),
                            $('<small>'),
                        ));
                    }
                    const card = inheritedOutfits.get(outfit.id);
                    card.find('.ExtBlocks-outfit-name').text(outfit.name || 'Unnamed outfit');
                    card.children('p').text(outfit.tags);
                    card.children('small').text(`Edit in ${outfit.source || 'the original block'}`);
                    inherited.push(card.get(0));
                }
                setWardrobeRows(sharedRows, [
                    ...shared.wardrobeCards.toArray(),
                    ...localCards.filter(card => card.dataset.outfitScope === 'shared'),
                    ...inherited,
                ]);
                if (!ownerGroups.has(target)) ownerGroups.set(target, new Map());
                const groups = ownerGroups.get(target);
                const owners = new Map();
                for (const editor of editors) {
                    for (const card of editor.wardrobeCards.toArray()) {
                        if (card.dataset.outfitScope !== 'personal') continue;
                        const key = JSON.stringify([editor.contextItem.id, card.dataset.outfitOwnerId]);
                        if (!owners.has(key)) owners.set(key, []);
                        owners.get(key).push(card);
                    }
                }
                const names = new Map();
                const groupsToShow = [];
                for (const [key, cards] of owners) {
                    if (!groups.has(key)) {
                        groups.set(key, $('<details>', { class: 'ExtBlocks-wardrobe-owner-group' }).append(
                            $('<summary>').append($('<span>'), $('<small>')),
                            $('<div>', { class: 'ExtBlocks-wardrobe-rows' }),
                        ));
                    }
                    const group = groups.get(key);
                    const owner = $(cards[0]).find('.ExtBlocks-outfit-owner').text();
                    names.set(owner, (names.get(owner) ?? 0) + 1);
                    const caption = names.get(owner) > 1 ? `${owner} · #${names.get(owner)}` : owner;
                    group.find('summary').first().children('span').text(caption);
                    group.find('summary').first().children('small').text(String(cards.length));
                    setWardrobeRows(group.children('div'), cards);
                    groupsToShow.push(group.get(0));
                }
                setWardrobeRows(personalRows, groupsToShow);
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
                        } else {
                            item.disabled = editor.itemDisabled || item.library.characters.every(character => !character.enabled);
                        }
                        if (split) {
                            block.context = context.flatMap(entry => entry === item ? [entry, split] : [entry]);
                        }
                        if (set) saveSettingsDebounced();
                        else await BlockService.saveBlock(block, true);
                        attached = true;
                        editor.itemDisabled = isContextItemDisabled(item);
                        const previousFlags = readCharacterLibrary(priorLibrary).characters.map(character => [character.id, character.enabled]);
                        const nextFlags = item.library.characters.map(character => [character.id, character.enabled]);
                        if (wasDisabled !== item.disabled || JSON.stringify(previousFlags) !== JSON.stringify(nextFlags)) {
                            $(document).triggerHandler('extblocks-context-inclusion', [block, item]);
                        }
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
                    characterActions: (row, character, summary) => {
                        const key = JSON.stringify([target.set?.name ?? card?.avatar ?? '', block.id ?? block.name, item.id, character.id]);
                        const star = action('', 'fa-star', () => {
                            if (favorites.has(key)) favorites.delete(key);
                            else favorites.add(key);
                            settings.quickFavorites = [...favorites];
                            saveSettingsDebounced();
                            updateStar();
                            filterList();
                        }).addClass('ExtBlocks-favorite-button');
                        const updateStar = () => {
                            const active = favorites.has(key);
                            row.attr('data-favorite', String(active));
                            const label = active ? 'Remove from favorites' : 'Add to favorites';
                            star.attr({ 'aria-pressed': String(active), 'aria-label': label, title: label });
                        };
                        row.attr('data-context-label', item.name ?? '');
                        summary.append($('<small>', { class: 'ExtBlocks-character-context' }));
                        row.children('.ExtBlocks-character-actions').prepend(star);
                        updateStar();
                    },
                    splitCharacter: (characterId, library) => {
                        const split = splitCharacterContext(item, library, characterId, uuidv4());
                        if (split) void save(split.remainder, split.contextItem);
                    },
                });
                editor.contextItem = item;
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
                    if (target) editorsForBlock(target);
                    panel.append(sharedSection, personalSection);
                } else if (target) {
                    const blockPanel = $('<section>', { class: 'ExtBlocks-quick-block-panel' });
                    for (const editor of editorsForBlock(target)) blockPanel.append(editor.container);
                    panel.append(blockPanel);
                }
                const label = mode === 'characters' ? 'Search characters' : 'Search outfits or owners';
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
            search.on('input', filterList);
            const header = $('<header>', { class: 'ExtBlocks-quick-header' }).append(
                $('<h3>').text('ExtBlocks'),
                $('<label>').append($('<span>').text('Block preset'), picker),
            );
            popup.append(header, tabs, $('<div>', { class: 'ExtBlocks-quick-toolbar' }).append(search, favoriteFilter, add), status, panel, empty);
            if (targets[selected]?.block.disabled) status.text('This block is disabled.');
            render();
            const onBlockEdited = (_event, previous, current) => {
                const target = targets.find(entry => entry.block === previous);
                if (target) {
                    for (const editor of cached.get(target) ?? []) editor.wardrobeCards.remove();
                    cached.delete(target);
                    ownerGroups.delete(target);
                    target.block = current;
                }
                for (const editors of cached.values()) {
                    for (const editor of editors) editor.refreshOutfitChoices();
                }
                if (target === targets[selected]) render();
                else showList();
            };
            $(document).on('extblocks-block-edited', onBlockEdited);
            try {
                await callGenericPopup(popup, POPUP_TYPE.TEXT, '', {
                    large: true, wide: true, allowVerticalScrolling: true, leftAlign: true, okButton: 'Close',
                    onClosing: () => !saving,
                });
            } finally {
                $(document).off('extblocks-block-edited', onBlockEdited);
            }
        } catch (error) {
            console.error('[ExtBlocks] Could not open library:', error);
            toastr.error('[ExtBlocks] Could not open the character library.');
        } finally {
            popupOpen = false;
        }
    },
};
