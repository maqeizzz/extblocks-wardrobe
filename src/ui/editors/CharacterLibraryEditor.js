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
    constructor(container, createId, { save = null, onRender = null, sharedChoices = () => [] } = {}) {
        this.container = container;
        this.createId = createId;
        this.save = save;
        this.onRender = onRender;
        this.sharedChoices = sharedChoices;
        this.drafts = new WeakMap();
    }

    load(library) {
        this.library = readCharacterLibrary(library);
        this.render();
    }

    async persist() {
        if (this.save) await this.save(this.library);
    }

    addEntry(mode, character = null) {
        const id = this.createId();
        if (mode === 'characters') {
            this.library.characters.push({ id, name: '', appearance: '', outfitId: '', enabled: !this.save });
        } else {
            this.library.outfits.push({ id, name: '', tags: '', ownerId: character?.id ?? '' });
            if (character) character.outfitId = id;
        }
        this.render(character?.id ?? id);
        void this.persist();
    }

    textFields(entry, descriptionKey, label, onSave) {
        const draft = this.drafts.get(entry) ?? { name: entry.name, [descriptionKey]: entry[descriptionKey] };
        this.drafts.set(entry, draft);
        const update = (key, value) => {
            draft[key] = value;
            for (const field of this.container.find('[data-extblocks-field]')) {
                const input = $(field);
                if (input.data('entry') === entry && field.dataset.extblocksField === key && field.value !== value) {
                    field.value = value;
                }
            }
            if (!this.save) {
                entry[key] = value;
                onSave();
            }
        };
        const field = (key, multiline) => textField(draft[key], value => update(key, value), multiline)
            .attr('data-extblocks-field', key).data('entry', entry);
        const fields = $('<div>').append(
            labeled('Name', field('name', false)),
            labeled(label, field(descriptionKey, true)),
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
        const outfitSummaries = new Map();
        const refreshChoices = () => {
            const choices = [...outfits, ...this.sharedChoices()];
            for (const [outfit, summary] of outfitSummaries) {
                summary.text(outfit.name || 'Unnamed outfit');
            }
            for (const { select, outfit } of [...ownerSelects, ...inlineOutfits.map(entry => entry.owner).filter(Boolean)]) {
                fillOwnerSelect(select, outfit);
            }
            for (const { select, character } of outfitSelects) {
                const available = getAvailableOutfits(choices, character.id);
                if (this.save) {
                    const selected = available.find(outfit => outfit.id === character.outfitId)?.id ?? '';
                    select.empty();
                    for (const outfit of [{ id: '', name: 'No outfit' }, ...available]) {
                        const isSelected = selected === outfit.id;
                        const choice = button(outfit.name || 'Unnamed outfit', () => {
                            if (isSelected) return;
                            character.outfitId = outfit.id;
                            refreshChoices();
                            select.find('button[aria-pressed="true"]').trigger('focus');
                            void this.persist();
                        }).attr('aria-pressed', String(isSelected)).addClass('ExtBlocks-outfit-chip');
                        choice.prepend($('<i>', { class: outfit.id ? 'fa-solid fa-shirt' : 'fa-solid fa-ban', 'aria-hidden': 'true' }));
                        select.append(choice);
                    }
                    continue;
                }
                select.empty().append(new Option('No outfit', ''));
                for (const outfit of available) {
                    select.append(new Option(outfit.name || 'Unnamed outfit', outfit.id));
                }
                select.val(character.outfitId || '');
                if (select.val() === null) select.val('');
            }
            for (const entry of inlineOutfits) {
                const outfit = getAvailableOutfits(choices, entry.character.id).find(item => item.id === entry.character.outfitId);
                if (entry.outfit === outfit && !outfit?.shared) continue;
                entry.outfit = outfit;
                entry.owner = null;
                entry.panel.empty();
                if (outfit?.shared) {
                    entry.panel.prop('open', true).append(
                        $('<summary>').text('Shared outfit'),
                        $('<p>').text(outfit.tags || 'Add clothing tags in Wardrobe.'),
                    );
                } else if (outfit) {
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
        const outfitFields = (outfit, owner) => $('<div>').append(
            this.textFields(outfit, 'tags', 'Clothing tags', () => {
                refreshChoices();
                this.onRender?.();
            }),
            labeled('Available to', owner),
        );

        const charactersSection = $('<div>', { class: 'ExtBlocks-characters-section' });
        if (!this.save) charactersSection.append($('<h4>').text('Characters'));
        for (const character of characters) {
            const summary = $('<summary>').text(character.name || 'Unnamed character');
            const details = this.textFields(character, 'appearance', 'Appearance tags', () => {
                summary.text(character.name || 'Unnamed character');
                refreshChoices();
                this.onRender?.();
            });
            const select = this.save ? $('<div>', { class: 'ExtBlocks-outfit-choices', role: 'group', 'aria-label': 'Outfits' })
                : $('<select>', { class: 'text_pole wide100p' }).on('change', event => {
                character.outfitId = event.target.value;
                refreshChoices();
            });
            outfitSelects.push({ select, character });
            const enabled = $('<input>', { type: 'checkbox', 'aria-label': 'Include in prompt' })
                .prop('checked', character.enabled).on('change', event => {
                character.enabled = event.target.checked;
                void this.persist();
            });
            const toggle = $('<label>', { class: 'checkbox_label ExtBlocks-character-toggle' }).append(enabled, ' In prompt');
            const inline = this.save ? $('<details>') : null;
            if (inline) inlineOutfits.push({ character, panel: inline });
            const card = $('<details>').prop('open', openId === character.id).append(
                summary, details, this.save ? select : labeled('Outfit', select), ...(inline ? [inline] : [toggle]),
                ...(this.save ? [button('Add personal outfit', () => this.addEntry('wardrobe', character))] : []),
                button('Remove character', () => {
                    this.library.characters = characters.filter(item => item !== character);
                    this.library.outfits = outfits.filter(outfit => outfit.ownerId !== character.id);
                    this.render();
                    void this.persist();
                }),
            );
            charactersSection.append(this.save
                ? $('<article>', { class: 'ExtBlocks-character-card' }).append(toggle, card)
                : card);
        }
        if (!this.save) charactersSection.append(button('Add character', () => this.addEntry('characters')));

        const wardrobe = $('<div>', { class: 'ExtBlocks-wardrobe-section' });
        if (!this.save) wardrobe.append($('<h4>').text('Wardrobe'));
        for (const outfit of outfits) {
            const summary = $('<summary>').text(outfit.name || 'Unnamed outfit');
            outfitSummaries.set(outfit, summary);
            const select = ownerSelect(outfit);
            const fields = outfitFields(outfit, select);
            ownerSelects.push({ select, outfit });
            wardrobe.append($('<details>', { class: 'ExtBlocks-outfit-card' }).prop('open', openId === outfit.id).append(
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
        if (!this.save) wardrobe.append(button('Add outfit', () => this.addEntry('wardrobe')));

        this.container.append(charactersSection, wardrobe);
        this.refreshOutfitChoices = refreshChoices;
        refreshChoices();
        this.onRender?.();
    }
}
