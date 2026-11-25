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
    constructor(container, createId) {
        this.container = container;
        this.createId = createId;
    }

    load(library) {
        this.library = readCharacterLibrary(library);
        this.render();
    }

    render(openId) {
        const { characters, outfits } = this.library;
        this.container.empty();

        const ownerSelects = [];
        const outfitSelects = [];
        const refreshChoices = () => {
            for (const { select, outfit } of ownerSelects) {
                select.empty().append(new Option('Shared', ''));
                for (const character of characters) {
                    select.append(new Option(character.name || 'Unnamed character', character.id));
                }
                if (outfit.ownerId && !characters.some(character => character.id === outfit.ownerId)) {
                    select.append(new Option('Missing character', outfit.ownerId));
                }
                select.val(outfit.ownerId);
            }
            for (const { select, character } of outfitSelects) {
                select.empty().append(new Option('No outfit', ''));
                for (const outfit of getAvailableOutfits(outfits, character.id)) {
                    select.append(new Option(outfit.name || 'Unnamed outfit', outfit.id));
                }
                select.val(character.outfitId || '');
                if (select.val() === null) select.val('');
            }
        };

        const charactersSection = $('<div>').append($('<h4>').text('Characters'));
        for (const character of characters) {
            const summary = $('<summary>').text(character.name || 'Unnamed character');
            const name = textField(character.name, value => {
                character.name = value;
                summary.text(value || 'Unnamed character');
                refreshChoices();
            });
            const appearance = textField(character.appearance, value => { character.appearance = value; }, true);
            const select = $('<select>', { class: 'text_pole wide100p' }).on('change', event => {
                character.outfitId = event.target.value;
            });
            outfitSelects.push({ select, character });
            const enabled = $('<input>', { type: 'checkbox' }).prop('checked', character.enabled).on('change', event => {
                character.enabled = event.target.checked;
            });
            charactersSection.append($('<details>').prop('open', openId === character.id).append(
                summary, labeled('Name', name), labeled('Appearance tags', appearance),
                labeled('Outfit', select), $('<label class="checkbox_label">').append(enabled, ' Include in prompt'),
                button('Remove character', () => {
                    this.library.characters = characters.filter(item => item !== character);
                    this.library.outfits = outfits.filter(outfit => outfit.ownerId !== character.id);
                    this.render();
                }),
            ));
        }
        charactersSection.append(button('Add character', () => {
            const id = this.createId();
            characters.push({ id, name: '', appearance: '', outfitId: '', enabled: true });
            this.render(id);
        }));

        const wardrobe = $('<div>').append($('<h4>').text('Wardrobe'));
        for (const outfit of outfits) {
            const summary = $('<summary>').text(outfit.name || 'Unnamed outfit');
            const name = textField(outfit.name, value => {
                outfit.name = value;
                summary.text(value || 'Unnamed outfit');
                refreshChoices();
            });
            const tags = textField(outfit.tags, value => { outfit.tags = value; }, true);
            const select = $('<select>', { class: 'text_pole wide100p' }).on('change', event => {
                outfit.ownerId = event.target.value;
                for (const character of characters) {
                    if (outfit.ownerId && character.id !== outfit.ownerId && character.outfitId === outfit.id) {
                        character.outfitId = '';
                    }
                }
                refreshChoices();
            });
            ownerSelects.push({ select, outfit });
            wardrobe.append($('<details>').prop('open', openId === outfit.id).append(
                summary, labeled('Name', name), labeled('Clothing tags', tags), labeled('Available to', select),
                button('Remove outfit', () => {
                    this.library.outfits = outfits.filter(item => item !== outfit);
                    for (const character of characters) {
                        if (character.outfitId === outfit.id) character.outfitId = '';
                    }
                    this.render();
                }),
            ));
        }
        wardrobe.append(button('Add outfit', () => {
            const id = this.createId();
            outfits.push({ id, name: '', tags: '', ownerId: '' });
            this.render(id);
        }));

        this.container.append(charactersSection, wardrobe);
        refreshChoices();
    }
}
