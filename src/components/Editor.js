import { useEffect, useRef } from 'react';
import CodeMirror from 'codemirror';
import { CodemirrorBinding } from 'y-codemirror';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/dracula.css';
import 'codemirror/theme/monokai.css';
import 'codemirror/theme/tomorrow-night-bright.css';
import 'codemirror/theme/material.css';
import 'codemirror/theme/material-darker.css';
import 'codemirror/theme/eclipse.css';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/css/css';
import 'codemirror/mode/xml/xml';
import 'codemirror/mode/htmlmixed/htmlmixed';
import 'codemirror/mode/python/python';
import 'codemirror/mode/clike/clike';
import 'codemirror/addon/edit/closetag';
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/keymap/sublime';
import { getLanguage } from '../editorPreferences';

const Editor = ({ doc, language, editorTheme, tabSize, lineWrapping, fontSize, onEditorReady, onFormat }) => {
    const textareaRef = useRef(null);
    const editorRef = useRef(null);
    const bindingRef = useRef(null);
    const formatRef = useRef(onFormat);
    formatRef.current = onFormat;

    useEffect(() => {
        const editor = CodeMirror.fromTextArea(textareaRef.current, {
            mode: getLanguage(language).mode,
            autoCloseTags: true,
            keyMap: 'sublime',
            theme: editorTheme,
            autoCloseBrackets: true,
            lineNumbers: true,
            lineWrapping,
            tabSize,
            indentUnit: tabSize,
            indentWithTabs: false,
            extraKeys: { 'Shift-Alt-F': () => formatRef.current() },
        });
        editorRef.current = editor;
        const input = editor.getInputField();
        input.setAttribute('aria-label', 'Shared code editor');
        input.setAttribute('aria-multiline', 'true');

        const binding = new CodemirrorBinding(doc.getText('code'), editor, null);
        bindingRef.current = binding;
        editor.on('cursorActivity', (instance) => {
            const cursor = instance.getCursor();
            input.dataset.cursor = `${cursor.line + 1}:${cursor.ch + 1}`;
        });
        onEditorReady({ editor, binding });

        return () => {
            binding.destroy();
            editor.toTextArea();
            editorRef.current = null;
            bindingRef.current = null;
            onEditorReady(null);
        };
        // This editor and Yjs binding are created once per room document.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doc]);

    useEffect(() => {
        if (!editorRef.current) return;
        editorRef.current.setOption('mode', getLanguage(language).mode);
    }, [language]);

    useEffect(() => {
        if (editorRef.current) editorRef.current.setOption('theme', editorTheme);
    }, [editorTheme]);

    useEffect(() => {
        if (editorRef.current) {
            editorRef.current.setOption('tabSize', tabSize);
            editorRef.current.setOption('indentUnit', tabSize);
        }
    }, [tabSize]);

    useEffect(() => {
        if (editorRef.current) editorRef.current.setOption('lineWrapping', lineWrapping);
    }, [lineWrapping]);

    useEffect(() => {
        if (editorRef.current) {
            editorRef.current.getWrapperElement().style.setProperty('--editor-font-size', `${fontSize}px`);
            editorRef.current.refresh();
        }
    }, [fontSize]);

    return <textarea ref={textareaRef} aria-label="Shared code editor" />;
};

export default Editor;
