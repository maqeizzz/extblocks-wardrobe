const SEARCH_MARKER = '<<<<<<< SEARCH';
const SEPARATOR_MARKER = '=======';
const REPLACE_MARKER = '>>>>>>> REPLACE';

/**
 * Error raised when a search/replace response cannot be parsed or applied safely.
 */
export class SearchReplaceDiffError extends Error {
    constructor(message, code, hunkIndex = null) {
        super(message);
        this.name = 'SearchReplaceDiffError';
        this.code = code;
        this.hunkIndex = hunkIndex;
    }
}

function isFenceLine(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

function markerEquals(line, marker) {
    return line.trim() === marker;
}

/**
 * Parses an aider-style search/replace diff.
 *
 * @param {string} output Raw model output.
 * @returns {{search: string, replace: string}[]}
 */
export function parseSearchReplaceDiff(output) {
    if (typeof output !== 'string' || output.trim() === '') {
        throw new SearchReplaceDiffError('The model returned an empty diff.', 'EMPTY_DIFF');
    }

    const lines = output.replace(/\r\n?/g, '\n').split('\n');
    const hunks = [];
    let index = 0;

    const skipOutsideWhitespaceAndFences = () => {
        while (index < lines.length && (lines[index].trim() === '' || isFenceLine(lines[index]))) {
            index++;
        }
    };

    skipOutsideWhitespaceAndFences();

    while (index < lines.length) {
        if (!markerEquals(lines[index], SEARCH_MARKER)) {
            throw new SearchReplaceDiffError(
                `Unexpected content outside a SEARCH/REPLACE hunk at line ${index + 1}.`,
                'UNEXPECTED_CONTENT',
                hunks.length,
            );
        }
        index++;

        const searchLines = [];
        while (index < lines.length && !markerEquals(lines[index], SEPARATOR_MARKER)) {
            if (markerEquals(lines[index], SEARCH_MARKER) || markerEquals(lines[index], REPLACE_MARKER)) {
                throw new SearchReplaceDiffError(
                    `Malformed SEARCH section in hunk ${hunks.length + 1}.`,
                    'MALFORMED_HUNK',
                    hunks.length,
                );
            }
            searchLines.push(lines[index]);
            index++;
        }

        if (index >= lines.length) {
            throw new SearchReplaceDiffError(
                `Missing ======= marker in hunk ${hunks.length + 1}.`,
                'MALFORMED_HUNK',
                hunks.length,
            );
        }
        index++;

        const replaceLines = [];
        while (index < lines.length && !markerEquals(lines[index], REPLACE_MARKER)) {
            if (markerEquals(lines[index], SEARCH_MARKER)) {
                throw new SearchReplaceDiffError(
                    `Malformed REPLACE section in hunk ${hunks.length + 1}.`,
                    'MALFORMED_HUNK',
                    hunks.length,
                );
            }
            replaceLines.push(lines[index]);
            index++;
        }

        if (index >= lines.length) {
            throw new SearchReplaceDiffError(
                `Missing >>>>>>> REPLACE marker in hunk ${hunks.length + 1}.`,
                'MALFORMED_HUNK',
                hunks.length,
            );
        }
        index++;

        const search = searchLines.join('\n');
        const replace = replaceLines.join('\n');
        if (search.length === 0) {
            throw new SearchReplaceDiffError(
                `SEARCH section in hunk ${hunks.length + 1} is empty.`,
                'EMPTY_SEARCH',
                hunks.length,
            );
        }

        hunks.push({ search, replace });
        skipOutsideWhitespaceAndFences();
    }

    if (hunks.length === 0) {
        throw new SearchReplaceDiffError('No SEARCH/REPLACE hunks were found.', 'NO_HUNKS');
    }

    return hunks;
}

function adaptLineEndings(text, source) {
    if (!source.includes('\r\n')) return text;
    return text.replace(/\n/g, '\r\n');
}

/**
 * Applies parsed hunks sequentially to a local string. A SEARCH section must
 * match exactly once at the moment its hunk is applied.
 *
 * @param {string} source Text to modify.
 * @param {{search: string, replace: string}[]} hunks Parsed hunks.
 * @returns {{text: string, appliedCount: number}}
 */
export function applySearchReplaceDiff(source, hunks) {
    if (typeof source !== 'string') {
        throw new SearchReplaceDiffError('The rewrite source is not a string.', 'INVALID_SOURCE');
    }
    if (!Array.isArray(hunks) || hunks.length === 0) {
        throw new SearchReplaceDiffError('No SEARCH/REPLACE hunks were provided.', 'NO_HUNKS');
    }

    let result = source;

    for (let index = 0; index < hunks.length; index++) {
        const hunk = hunks[index];
        if (!hunk || typeof hunk.search !== 'string' || hunk.search.length === 0 || typeof hunk.replace !== 'string') {
            throw new SearchReplaceDiffError(
                `Invalid hunk ${index + 1}.`,
                'MALFORMED_HUNK',
                index,
            );
        }

        const search = adaptLineEndings(hunk.search, result);
        const replacement = adaptLineEndings(hunk.replace, result);
        const firstMatch = result.indexOf(search);

        if (firstMatch === -1) {
            throw new SearchReplaceDiffError(
                `SEARCH section from hunk ${index + 1} was not found in the rewrite target.`,
                'SEARCH_NOT_FOUND',
                index,
            );
        }

        const secondMatch = result.indexOf(search, firstMatch + 1);
        if (secondMatch !== -1) {
            throw new SearchReplaceDiffError(
                `SEARCH section from hunk ${index + 1} is ambiguous (2 or more matches).`,
                'AMBIGUOUS_SEARCH',
                index,
            );
        }

        result = result.slice(0, firstMatch) + replacement + result.slice(firstMatch + search.length);
    }

    return { text: result, appliedCount: hunks.length };
}

export const searchReplaceDiffTemplate = [
    '<<<<<<< SEARCH',
    'exact text copied verbatim from the rewrite target',
    '=======',
    'replacement text',
    '>>>>>>> REPLACE',
].join('\n');

export const searchReplaceDiffProtocol = [
    'Return only one or more SEARCH/REPLACE hunks in this exact format:',
    searchReplaceDiffTemplate,
    '',
    'Rules:',
    '- SEARCH must be non-empty and match the rewrite target exactly, including whitespace and punctuation.',
    '- Include enough unchanged context in SEARCH to make every match unique.',
    '- Use multiple hunks for separate changes.',
    '- To delete text, leave the REPLACE section empty.',
    '- Do not return explanations, XML wrappers, or the complete rewritten text.',
].join('\n');
