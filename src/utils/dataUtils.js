import { update as mingoUpdate } from '../../external/mingo.js';

/**
 * Updates an existing item in a JSON array if it has the same name, or inserts it if not found.
 * @param {Object[]} jsonArray 
 * @param {Object} newJson 
 * @returns {number} The index of the updated or inserted item.
 */
export function updateOrInsert(jsonArray, newJson) {
    let index = -1;

    for (let i = 0; i < jsonArray.length; i++) {
        if (jsonArray[i].name === newJson.name) {
            jsonArray[i] = newJson;
            index = i;
            return index;
        }
    }

    if (index === -1) {
        jsonArray.push(newJson);
        index = jsonArray.length - 1;
    }

    return index;
}

/**
 * Groups blocks by their context.
 * @param {Object[]} blocks 
 * @returns {Object} An object where keys are context strings and values are arrays of blocks.
 */
export function groupBlocksByContext(blocks) {
    const contextToString = (context) => context.map(item => item.name).join('_');

    const groupedBlocks = {};

    blocks.forEach(block => {
        const contextStr = contextToString(block.context);
        if (!groupedBlocks[contextStr]) {
            groupedBlocks[contextStr] = [];
        }
        groupedBlocks[contextStr].push(block);
    });

    return groupedBlocks;
}

/**
 * Combines global and scoped blocks, with scoped blocks taking priority.
 * @param {Object[]} globalBlocks 
 * @param {Object[]} scopedBlocks 
 * @returns {Object[]}
 */
export function priorityCombineBlocks(globalBlocks, scopedBlocks) {
    const combined = {};
    scopedBlocks.forEach(obj => {
        combined[obj.name] = obj;
    });

    globalBlocks.forEach(obj => {
        if (!combined[obj.name]) {
            combined[obj.name] = obj;
        }
    });
    return Object.values(combined);
}

/**
 * Applies MongoDB-style update operators to a document using mingo library.
 * Supports standard operators ($set, $inc, $push, etc.) and mingo-specific
 * top-level fields like arrayFilters, condition, and options.
 * @param {Object} doc The document to update.
 * @param {Object} updateObj The update object containing operators or mingo update parameters.
 * @returns {Object} The updated document.
 */
export function applyMongoUpdate(doc, updateObj) {
    if (!updateObj || typeof updateObj !== 'object') return doc;

    const { arrayFilters, condition, options, ...rest } = updateObj;

    // Normalize update object to ensure all remaining top-level keys are operators
    const modifier = {};
    for (const key in rest) {
        if (key.startsWith('$')) {
            modifier[key] = rest[key];
        } else {
            if (!modifier.$set) {
                modifier.$set = {};
            }
            modifier.$set[key] = rest[key];
        }
    }
    for (const op in modifier) {
        let opValue = modifier[op];
        if ((op === '$push' || op === '$addToSet') && typeof opValue === 'object' && opValue !== null) {
            for (const field in opValue) {
                const fieldVal = opValue[field];
                if (Array.isArray(fieldVal)) {
                    opValue[field] = { $each: fieldVal };
                }
            }
        }
        mingoUpdate(doc, { [op]: opValue }, arrayFilters, condition, options);
    }

return doc;
}