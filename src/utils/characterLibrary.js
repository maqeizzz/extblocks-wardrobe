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

export function getCatalogSharedChoices(settings) {
    if (!settings?.characterCatalog) return getSharedOutfitChoices(settings?.sharedWardrobe);
    return readCharacterLibrary(settings.characterCatalog).outfits.filter(outfit => !outfit.ownerId);
}

export function migrateCharacterCatalog(settings, blocks, activeBlocks, createId) {
    const existing = settings.characterCatalog;
    const catalog = readCharacterLibrary(existing);
    const importedCharacters = new Set(existing?.importedCharacters ?? []);
    const importedOutfits = new Map(existing?.importedOutfits ?? []);
    const active = new Set(activeBlocks);
    let changed = !existing;
    if (!existing) {
        catalog.outfits.push(...getSharedOutfitChoices(settings.sharedWardrobe).map(({ shared, ...outfit }) => outfit));
    }
    for (const block of [...activeBlocks, ...blocks]) {
        for (const item of Array.isArray(block?.context) ? block.context : []) {
            if (item?.type !== 'characters') continue;
            const library = readCharacterLibrary(item.library);
            for (const outfit of library.outfits) {
                const key = JSON.stringify([outfit.id, outfit.ownerId]);
                if (importedOutfits.has(key)) continue;
                const id = createId();
                importedOutfits.set(key, id);
                catalog.outfits.push({ ...outfit, id });
                changed = true;
            }
            for (const character of library.characters) {
                if (importedCharacters.has(character.id)) continue;
                const outfit = getAvailableOutfits(library.outfits, character.id).find(entry => entry.id === character.outfitId);
                const outfitId = outfit ? importedOutfits.get(JSON.stringify([outfit.id, outfit.ownerId])) : character.outfitId;
                catalog.characters.push({
                    ...character, outfitId,
                    enabled: !existing && character.enabled && active.has(block) && !block.disabled && !item.disabled,
                });
                importedCharacters.add(character.id);
                changed = true;
            }
        }
    }
    if (changed) {
        settings.characterCatalog = {
            ...catalog, importedCharacters: [...importedCharacters], importedOutfits: [...importedOutfits],
        };
    }
    return changed;
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
