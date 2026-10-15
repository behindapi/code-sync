const FORMAT_PARSERS = {
    javascript: 'babel',
    json: 'json',
    css: 'css',
    html: 'html',
};

export function canFormat(language) {
    return Object.prototype.hasOwnProperty.call(FORMAT_PARSERS, language);
}

export async function formatCode(code, language) {
    const parser = FORMAT_PARSERS[language];
    if (!parser) throw new Error('Formatting is available for JavaScript, JSON, CSS, and HTML.');

    const [prettierModule, ...pluginModules] = await Promise.all([
        import('prettier/standalone'),
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
        import('prettier/plugins/html'),
        import('prettier/plugins/postcss'),
    ]);
    const prettier = prettierModule.default || prettierModule;
    const plugins = pluginModules.map((module) => module.default || module);
    return prettier.format(code, {
        parser,
        plugins,
        semi: true,
        singleQuote: true,
        tabWidth: 2,
        printWidth: 88,
    });
}
