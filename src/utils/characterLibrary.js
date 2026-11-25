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

export function getSharedOutfitChoices(sharedWardrobe) {
    return readCharacterLibrary({ outfits: sharedWardrobe }).outfits.map(outfit => ({
        ...outfit,
        id: `shared:${outfit.id}`,
        ownerId: '',
        shared: true,
    }));
}

export function formatCharacterLibrary(library, sharedWardrobe) {
    const { characters, outfits } = readCharacterLibrary(library);
    outfits.push(...getSharedOutfitChoices(sharedWardrobe));
    return characters.filter(character => character.enabled).map(character => {
        const outfit = getAvailableOutfits(outfits, character.id).find(item => item.id === character.outfitId);
        const tags = [character.appearance, outfit?.tags].map(text => text?.trim()).filter(Boolean).join(', ');
        const name = character.name.trim();
        return tags && name ? `${name}: ${tags}` : tags;
    }).filter(Boolean).join('\n');
}
