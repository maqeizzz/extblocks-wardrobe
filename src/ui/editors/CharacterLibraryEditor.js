import { getAvailableOutfits, readCharacterLibrary } from '../../utils/characterLibrary.js';

function button(label, action) {
    return $('<button>', { type: 'button', class: 'menu_button', text: label }).on('click', action);
}

function labeled(label, field) {
    return $('<label>', { class: 'wide100p' }).append($('<span>').text(label), field);
}

function textField(value, update, multiline = false) {
    return $(multiline ? '<textarea>' : '<input>', { class: 'text_pole wide100p' })
        .val(value).on('input', event => update(event.target.value));
}

export class CharacterLibraryEditor {
    constructor(container, createId, { mode = 'both', save = null } = {}) {
        this.container = container;
        this.createId = createId;
        this.mode = mode;
        this.save = save;
        this.drafts = new WeakMap();
    }

    load(library) {
        this.library = readCharacterLibrary(library);
        this.render();
    }

    async persist() {
        if (this.save) await this.save(this.library);
    }

    textFields(entry, descriptionKey, label, onSave) {
        const draft = this.drafts.get(entry) ?? { name: entry.name, [descriptionKey]: entry[descriptionKey] };
        this.drafts.set(entry, draft);
        const update = (key, value) => {
            draft[key] = value;
            if (!this.save) {
                entry[key] = value;
                onSave();
            }
        };
        const fields = $('<div>').append(
            labeled('Name', textField(draft.name, value => update('name', value))),
            labeled(label, textField(draft[descriptionKey], value => update(descriptionKey, value), true)),
        );
        if (this.save) {
            fields.append(button('Save details', () => {
                Object.assign(entry, draft);
                onSave();
                void this.persist();
            }));
        }
        return fields;
    }

    render(openId) {
        const { characters, outfits } = this.library;
        this.container.empty();

        const ownerSelects = [];
        const outfitSelects = [];
        const inlineOutfits = [];
        const refreshChoices = () => {
            for (const { select, outfit } of [...ownerSelects, ...inlineOutfits.map(entry => entry.owner).filter(Boolean)]) {
                fillOwnerSelect(select, outfit);
            }
            for (const { select, character } of outfitSelects) {
                select.empty().append(new Option('No outfit', ''));
                for (const outfit of getAvailableOutfits(outfits, character.id)) {
                    select.append(new Option(outfit.name || 'Unnamed outfit', outfit.id));
                }
                select.val(character.outfitId || '');
                if (select.val() === null) select.val('');
            }
            for (const entry of inlineOutfits) {
                const outfit = getAvailableOutfits(outfits, entry.character.id).find(item => item.id === entry.character.outfitId);
                if (entry.outfit === outfit) continue;
                entry.outfit = outfit;
                entry.owner = null;
                entry.panel.empty();
                if (outfit) {
                    const owner = ownerSelect(outfit);
                    entry.owner = { select: owner, outfit };
                    entry.panel.prop('open', true).append($('<summary>').text('Edit selected outfit'), outfitFields(outfit, owner));
                }
            }
        };

        const fillOwnerSelect = (select, outfit) => {
            select.empty().append(new Option('Shared', ''));
            for (const character of characters) {
                select.append(new Option(character.name || 'Unnamed character', character.id));
            }
            if (outfit.ownerId && !characters.some(character => character.id === outfit.ownerId)) {
                select.append(new Option('Missing character', outfit.ownerId));
            }
            select.val(outfit.ownerId);
        };
        const ownerSelect = outfit => {
            const select = $('<select>', { class: 'text_pole wide100p' });
            fillOwnerSelect(select, outfit);
            return select.on('change', event => {
                outfit.ownerId = event.target.value;
                for (const character of characters) {
                    if (outfit.ownerId && character.id !== outfit.ownerId && character.outfitId === outfit.id) {
                        character.outfitId = '';
                    }
                }
                refreshChoices();
                void this.persist();
            });
        };
        const outfitFields = (outfit, owner, onSave = refreshChoices) => $('<div>').append(
            this.textFields(outfit, 'tags', 'Clothing tags', onSave),
            labeled('Available to', owner),
        );

        const charactersSection = $('<div>').append($('<h4>').text('Characters'));
        for (const character of characters) {
            const summary = $('<summary>').text(character.name || 'Unnamed character');
            const details = this.textFields(character, 'appearance', 'Appearance tags', () => {
                summary.text(character.name || 'Unnamed character');
                refreshChoices();
            });
            const select = $('<select>', { class: 'text_pole wide100p' }).on('change', event => {
                character.outfitId = event.target.value;
                refreshChoices();
                void this.persist();
            });
            outfitSelects.push({ select, character });
            const enabled = $('<input>', { type: 'checkbox' }).prop('checked', character.enabled).on('change', event => {
                character.enabled = event.target.checked;
                void this.persist();
            });
            const inline = this.mode === 'characters' ? $('<details>') : null;
            if (this.mode === 'characters') inlineOutfits.push({ character, panel: inline });
            charactersSection.append($('<details>').prop('open', openId === character.id).append(
                summary, labeled('Outfit', select), ...(inline ? [inline] : []), details,
                $('<label class="checkbox_label">').append(enabled, ' Include in prompt'),
                button('Remove character', () => {
                    this.library.characters = characters.filter(item => item !== character);
                    this.library.outfits = outfits.filter(outfit => outfit.ownerId !== character.id);
                    this.render();
                    void this.persist();
                }),
            ));
        }
        charactersSection.append(button('Add character', () => {
            const id = this.createId();
            characters.push({ id, name: '', appearance: '', outfitId: '', enabled: true });
            this.render(id);
            void this.persist();
        }));

        const wardrobe = $('<div>').append($('<h4>').text('Wardrobe'));
        for (const outfit of outfits) {
            const summary = $('<summary>').text(outfit.name || 'Unnamed outfit');
            const select = ownerSelect(outfit);
            const fields = outfitFields(outfit, select, () => {
                summary.text(outfit.name || 'Unnamed outfit');
                refreshChoices();
            });
            ownerSelects.push({ select, outfit });
            wardrobe.append($('<details>').prop('open', openId === outfit.id).append(
                summary, fields,
                button('Remove outfit', () => {
                    this.library.outfits = outfits.filter(item => item !== outfit);
                    for (const character of characters) {
                        if (character.outfitId === outfit.id) character.outfitId = '';
                    }
                    this.render();
                    void this.persist();
                }),
            ));
        }
        wardrobe.append(button('Add outfit', () => {
            const id = this.createId();
            outfits.push({ id, name: '', tags: '', ownerId: '' });
            this.render(id);
            void this.persist();
        }));

        if (this.mode !== 'wardrobe') this.container.append(charactersSection);
        if (this.mode !== 'characters') this.container.append(wardrobe);
        refreshChoices();
    }
}
