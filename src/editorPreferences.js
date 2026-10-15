export const LANGUAGE_OPTIONS = [
    { id: 'javascript', label: 'JavaScript', mode: 'javascript', parser: 'babel', runnable: true },
    { id: 'json', label: 'JSON', mode: { name: 'javascript', json: true }, parser: 'json' },
    { id: 'css', label: 'CSS', mode: 'css', parser: 'css' },
    { id: 'html', label: 'HTML', mode: 'htmlmixed', parser: 'html' },
    { id: 'python', label: 'Python', mode: 'python' },
    { id: 'java', label: 'Java', mode: 'text/x-java' },
    { id: 'c', label: 'C', mode: 'text/x-csrc' },
    { id: 'cpp', label: 'C++', mode: 'text/x-c++src' },
];

export const EDITOR_THEMES = [
    { id: 'dracula', label: 'Dracula' },
    { id: 'monokai', label: 'Monokai' },
    { id: 'material-darker', label: 'Material Darker' },
    { id: 'material', label: 'Material' },
    { id: 'tomorrow-night-bright', label: 'Tomorrow Night' },
    { id: 'eclipse', label: 'Eclipse' },
];

const STORAGE_KEY = 'code-sync-editor-preferences-v1';
const DEFAULT_PREFERENCES = {
    language: 'javascript',
    editorTheme: 'dracula',
    appearance: 'dark',
    tabSize: 2,
    lineWrapping: false,
    fontSize: 15,
};

export function loadEditorPreferences() {
    try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
        return {
            ...DEFAULT_PREFERENCES,
            ...saved,
            language: LANGUAGE_OPTIONS.some(({ id }) => id === saved.language) ? saved.language : DEFAULT_PREFERENCES.language,
            editorTheme: EDITOR_THEMES.some(({ id }) => id === saved.editorTheme) ? saved.editorTheme : DEFAULT_PREFERENCES.editorTheme,
            appearance: ['dark', 'light'].includes(saved.appearance) ? saved.appearance : DEFAULT_PREFERENCES.appearance,
            tabSize: [2, 4].includes(Number(saved.tabSize)) ? Number(saved.tabSize) : DEFAULT_PREFERENCES.tabSize,
            lineWrapping: Boolean(saved.lineWrapping),
            fontSize: [13, 14, 15, 16, 18].includes(Number(saved.fontSize)) ? Number(saved.fontSize) : DEFAULT_PREFERENCES.fontSize,
        };
    } catch (_error) {
        return { ...DEFAULT_PREFERENCES };
    }
}

export function saveEditorPreferences(preferences) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (_error) {
        // Private browsing and storage limits should not prevent editing.
    }
}

export function getLanguage(languageId) {
    return LANGUAGE_OPTIONS.find(({ id }) => id === languageId) || LANGUAGE_OPTIONS[0];
}
