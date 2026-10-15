import { canFormat } from './formatCode';
import { EDITOR_THEMES, getLanguage, LANGUAGE_OPTIONS, loadEditorPreferences, saveEditorPreferences } from './editorPreferences';

describe('editor preferences and capability labels', () => {
    beforeEach(() => window.localStorage.clear());

    test('keeps syntax support separate from browser execution and formatting', () => {
        expect(LANGUAGE_OPTIONS).toHaveLength(8);
        expect(getLanguage('javascript').runnable).toBe(true);
        expect(getLanguage('python').runnable).toBeUndefined();
        expect(canFormat('javascript')).toBe(true);
        expect(canFormat('json')).toBe(true);
        expect(canFormat('python')).toBe(false);
    });

    test('persists valid local preferences and ignores unknown values', () => {
        saveEditorPreferences({ language: 'python', editorTheme: 'monokai', appearance: 'light', tabSize: 4, lineWrapping: true, fontSize: 18 });
        expect(loadEditorPreferences()).toMatchObject({ language: 'python', editorTheme: 'monokai', appearance: 'light', tabSize: 4, lineWrapping: true, fontSize: 18 });
        window.localStorage.setItem('code-sync-editor-preferences-v1', JSON.stringify({ language: 'brainfuck', editorTheme: 'not-a-theme', tabSize: 8 }));
        expect(loadEditorPreferences()).toMatchObject({ language: 'javascript', editorTheme: EDITOR_THEMES[0].id, tabSize: 2 });
    });
});
