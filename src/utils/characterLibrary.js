export function readCharacterLibrary(library) {
    return {
        characters: readEntries(library?.characters, ({ appearance, outfitId, enabled }) => ({
            appearance: readText(appearance),
            outfitId: readText(outfitId),
            enabled: enabled !== false,
        })),
        outfits: readEntries(library?.outfits, ({ tags, ownerId }) => ({
            tags: readText(tags),
            ownerId: readText(ownerId),
        })),
    };
}

function readText(value) {
    return typeof value === 'string' ? value : '';
}

function readEntries(entries, readFields) {
    if (!Array.isArray(entries)) return [];

    const ids = new Set();
    return entries.filter(entry => {
        if (typeof entry?.id !== 'string' || !entry.id || ids.has(entry.id)) return false;
        ids.add(entry.id);
        return true;
    }).map(entry => ({
        id: entry.id,
        name: readText(entry.name),
        ...readFields(entry),
    }));
}

export function getAvailableOutfits(outfits, characterId) {
    return outfits.filter(outfit => !outfit.ownerId || outfit.ownerId === characterId);
}

function getContextCharacters(item) {
    const characters = item.type === 'characters' ? item.library?.characters : undefined;
    return Array.isArray(characters) ? characters.filter(character => typeof character?.id === 'string' && character.id) : [];
}

export function isContextItemDisabled(item) {
    const characters = getContextCharacters(item);
    return Boolean(item.disabled || (characters.length && characters.every(character => character.enabled === false)));
}

export function setContextItemDisabled(item, disabled) {
    const characters = getContextCharacters(item);
    item.disabled = disabled;
    if (characters.length === 1 || (!disabled && characters.every(character => character.enabled === false))) {
        for (const character of characters) character.enabled = true;
    }
}

export function copyContextItemInclusion(target, source) {
    target.disabled = source.disabled;
    const flags = new Map(getContextCharacters(source).map(character => [character.id, character.enabled]));
    for (const character of getContextCharacters(target)) {
        if (flags.has(character.id)) character.enabled = flags.get(character.id);
    }
}

export function getSharedOutfitChoices(sharedWardrobe) {
    return readCharacterLibrary({ outfits: sharedWardrobe }).outfits.map(outfit => ({
        ...outfit,
        id: `shared:${outfit.id}`,
        ownerId: '',
        shared: true,
    }));
}

export function collectSharedOutfitChoices(settings, characterCards = []) {
    const choices = new Map(getSharedOutfitChoices(settings?.sharedWardrobe).map(outfit => [outfit.id, outfit]));
    const blocks = [
        ...(settings?.sets ?? []).flatMap(set => set.global_blocks ?? []),
        ...characterCards.flatMap(card => card?.data?.extensions?.ExtBlocks ?? []),
    ];
    for (const block of blocks) {
        for (const item of Array.isArray(block?.context) ? block.context : []) {
            if (item?.type !== 'characters') continue;
            for (const outfit of readCharacterLibrary(item.library).outfits) {
                if (!outfit.ownerId && !choices.has(outfit.id)) {
                    choices.set(outfit.id, { ...outfit, shared: true, source: block.name });
                }
            }
        }
    }
    return [...choices.values()];
}

export function mergeOutfitChoices(local, shared) {
    const ids = new Set(local.map(outfit => outfit.id));
    return [...local, ...shared.filter(outfit => !ids.has(outfit.id))];
}

export function formatCharacterLibrary(library, sharedChoices = []) {
    const { characters, outfits } = readCharacterLibrary(library);
    const choices = mergeOutfitChoices(outfits, sharedChoices);
    return characters.filter(character => character.enabled).map(character => {
        const outfit = getAvailableOutfits(choices, character.id).find(item => item.id === character.outfitId);
        const tags = [character.appearance, outfit?.tags].map(text => text?.trim()).filter(Boolean).join(', ');
        const name = character.name.trim();
        return tags && name ? `${name}: ${tags}` : tags;
    }).filter(Boolean).join('\n');
}

export function splitCharacterContext(item, library, characterId, newId) {
    const draft = readCharacterLibrary(library);
    const character = draft.characters.find(entry => entry.id === characterId);
    if (!character || draft.characters.length < 2) return;
    return {
        remainder: {
            characters: draft.characters.filter(entry => entry.id !== characterId),
            outfits: draft.outfits.filter(outfit => outfit.ownerId !== characterId),
        },
        contextItem: {
            id: newId,
            type: item.type,
            name: character.name.trim() || 'Unnamed character',
            role: item.role,
            disabled: Boolean(item.disabled || !character.enabled),
            singleCharacter: true,
            library: {
                characters: [{ ...character, enabled: true }],
                outfits: draft.outfits.filter(outfit => outfit.ownerId === characterId),
            },
        },
    };
}
