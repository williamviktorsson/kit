import fs from 'fs';
import path from 'path';
import colors from 'kleur';
import { posixify } from '../../utils/filesystem.js';
import { write_if_changed } from './utils.js';

/** @param {string} file */
const exists = (file) => fs.existsSync(file) && file;

/**
 * Writes the tsconfig that the user's tsconfig inherits from.
 * @param {import('types').ValidatedKitConfig} config
 */
export function write_tsconfig(config, cwd = process.cwd()) {
	const out = path.join(config.outDir, 'tsconfig.json');
	const user_file =
		exists(path.resolve(cwd, 'tsconfig.json')) || exists(path.resolve(cwd, 'jsconfig.json'));

	if (user_file) validate(config, cwd, out, user_file);

	/** @param {string} file */
	const project_relative = (file) => posixify(path.relative('.', file));

	/** @param {string} file */
	const config_relative = (file) => posixify(path.relative(config.outDir, file));

	const dirs = new Set([
		project_relative(path.dirname(config.files.routes)),
		project_relative(path.dirname(config.files.lib))
	]);

	/** @type {string[]} */
	const include = [];
	dirs.forEach((dir) => {
		include.push(config_relative(`${dir}/**/*.js`));
		include.push(config_relative(`${dir}/**/*.ts`));
		include.push(config_relative(`${dir}/**/*.svelte`));
	});

	/** @type {Record<string, string[]>} */
	const paths = {};
	const alias = {
		$lib: project_relative(config.files.lib),
		...config.alias
	};
	for (const [key, value] of Object.entries(alias)) {
		if (fs.existsSync(project_relative(value))) {
			paths[key] = [project_relative(value)];
			paths[key + '/*'] = [project_relative(value) + '/*'];
		}
	}

	write_if_changed(
		out,
		JSON.stringify(
			{
				compilerOptions: {
					// generated options
					baseUrl: config_relative('.'),
					paths,
					rootDirs: [config_relative('.'), './types'],

					// essential options
					// svelte-preprocess cannot figure out whether you have a value or a type, so tell TypeScript
					// to enforce using \`import type\` instead of \`import\` for Types.
					importsNotUsedAsValues: 'error',
					// Vite compiles modules one at a time
					isolatedModules: true,
					// TypeScript doesn't know about import usages in the template because it only sees the
					// script of a Svelte file. Therefore preserve all value imports. Requires TS 4.5 or higher.
					preserveValueImports: true,

					// This is required for svelte-kit package to work as expected
					// Can be overwritten
					lib: ['esnext', 'DOM'],
					moduleResolution: 'node',
					module: 'esnext',
					target: 'esnext'
				},
				include,
				exclude: [config_relative('node_modules/**'), './**']
			},
			null,
			'\t'
		)
	);
}

/**
 * @param {import('types').ValidatedKitConfig} config
 * @param {string} cwd
 * @param {string} out
 * @param {string} user_file
 */
function validate(config, cwd, out, user_file) {
	// we have to eval the file, since it's not parseable as JSON (contains comments)
	const user_tsconfig_json = fs.readFileSync(user_file, 'utf-8');
	const user_tsconfig = (0, eval)(`(${user_tsconfig_json})`);

	// we need to check that the user's tsconfig extends the framework config
	const extend = user_tsconfig.extends;
	const extends_framework_config = extend && path.resolve(cwd, extend) === out;

	const kind = path.basename(user_file);

	if (extends_framework_config) {
		const { paths: user_paths } = user_tsconfig.compilerOptions || {};

		if (user_paths && fs.existsSync(config.files.lib)) {
			/** @type {string[]} */
			const lib = user_paths['$lib'] || [];
			/** @type {string[]} */
			const lib_ = user_paths['$lib/*'] || [];

			const missing_lib_paths =
				!lib.some((relative) => path.resolve(cwd, relative) === config.files.lib) ||
				!lib_.some((relative) => path.resolve(cwd, relative) === path.join(config.files.lib, '/*'));

			if (missing_lib_paths) {
				console.warn(
					colors
						.bold()
						.yellow(`Your compilerOptions.paths in ${kind} should include the following:`)
				);
				const relative = posixify(path.relative('.', config.files.lib));
				console.warn(`{\n  "$lib":["${relative}"],\n  "$lib/*":["${relative}/*"]\n}`);
			}
		}
	} else {
		let relative = posixify(path.relative('.', out));
		if (!relative.startsWith('./')) relative = './' + relative;

		console.warn(
			colors.bold().yellow(`Your ${kind} should extend the configuration generated by SvelteKit:`)
		);
		console.warn(`{\n  "extends": "${relative}"\n}`);
	}
}
