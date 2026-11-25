import { BlockService } from '../services/BlockService.js';
import { CharacterLibraryEditor } from './editors/CharacterLibraryEditor.js';
import { migrateCharacterCatalog } from '../utils/characterLibrary.js';

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
            const cardBlocks = characters[characterId]?.data?.extensions?.ExtBlocks ?? [];
            const presetBlocks = settings.sets.flatMap(set => set.global_blocks ?? []);
            if (migrateCharacterCatalog(settings, [...presetBlocks, ...cardBlocks], BlockService.getAllBlocks(), uuidv4)) {
                saveSettingsDebounced();
            }

            let mode = 'characters';
            const popup = $('<div>', { class: 'ExtBlocks-quick-library' }).append($('<h3>').text('ExtBlocks'));
            const tabs = $('<div>', { class: 'ExtBlocks-quick-tabs', role: 'group', 'aria-label': 'ExtBlocks sections' });
            const panel = $('<div>', { class: 'ExtBlocks-character-library ExtBlocks-quick-list' });
            const search = $('<input>', { type: 'search', class: 'text_pole' });
            const status = $('<div>', { role: 'status', class: 'ExtBlocks-quick-status' });
            const empty = $('<p>');
            const showList = () => {
                const query = String(search.val()).trim().toLowerCase();
                const isCharacters = mode === 'characters';
                panel.attr('data-mode', mode);
                tabs.children().each((_, tab) => $(tab).attr('aria-pressed', String(tab.dataset.mode === mode)));
                let count = 0;
                panel.find(isCharacters ? '.ExtBlocks-character-card' : '.ExtBlocks-outfit-card').each((_, entry) => {
                    const summary = isCharacters ? $(entry).children('details').children('summary') : $(entry).children('summary');
                    const matches = summary.text().toLowerCase().includes(query);
                    $(entry).toggle(matches);
                    if (matches) count++;
                });
                empty.text(query ? 'No matches.' : isCharacters ? 'No characters yet.' : 'No outfits yet.').toggle(!count);
            };
            const editor = new CharacterLibraryEditor(panel, uuidv4, {
                onRender: showList,
                save: library => {
                    Object.assign(settings.characterCatalog, structuredClone(library));
                    saveSettingsDebounced();
                    status.text('Changes applied');
                },
            });
            const add = action('Add character', 'fa-plus', () => {
                search.val('');
                editor.addEntry(mode);
            });
            const selectTab = key => {
                mode = key;
                const label = key === 'characters' ? 'Search characters' : 'Search outfits';
                search.val('').attr('aria-label', label).attr('placeholder', label);
                add.children('span').text(key === 'characters' ? 'Add character' : 'Add outfit');
                showList();
            };
            for (const [key, label, icon] of [['characters', 'Characters', 'fa-user'], ['wardrobe', 'Wardrobe', 'fa-shirt']]) {
                tabs.append(action(label, icon, () => selectTab(key)).attr('data-mode', key));
            }
            search.on('input', showList);
            popup.append(tabs, $('<div>', { class: 'ExtBlocks-quick-toolbar' }).append(search, add), status, panel, empty);
            editor.load(settings.characterCatalog);
            selectTab(mode);
            await callGenericPopup(popup, POPUP_TYPE.TEXT, '', {
                large: true, wide: true, allowVerticalScrolling: true, leftAlign: true, okButton: 'Close',
            });
        } catch (error) {
            console.error('[ExtBlocks] Could not open library:', error);
            toastr.error('[ExtBlocks] Could not open the character library.');
        } finally {
            popupOpen = false;
        }
    },
};
