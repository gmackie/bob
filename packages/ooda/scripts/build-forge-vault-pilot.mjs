/** Bundle the disposable pilot for a Node 24 host with Git; embeds no config. */
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const [forgeRoot,output]=process.argv.slice(2);
if(!forgeRoot||!output)throw Error('Usage: build-forge-vault-pilot.mjs <built-forge-root> <output.mjs>');
const scripts=dirname(fileURLToPath(import.meta.url));
const require=createRequire(resolve(forgeRoot,'examples/acme/package.json'));
const {build}=require('esbuild');
let source=await readFile(resolve(scripts,'verify-forge-vault.mjs'),'utf8');
source=source.replace(/await load\(\s*"([^"]+)"\s*,?\s*\)/g,(_,path)=>'await import('+JSON.stringify(resolve(forgeRoot,'packages/runtime/dist',path))+')');
const result=await build({stdin:{contents:source,resolveDir:scripts,sourcefile:'verify-forge-vault.mjs',loader:'js'},outfile:output,bundle:true,platform:'node',target:'node24',format:'esm',define:{'process.env.FORGE_PILOT_BUNDLED':'"true"'},metafile:true,banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
await writeFile(output+'.manifest.json',JSON.stringify({sha256:createHash('sha256').update(await readFile(output)).digest('hex'),esbuildVersion:require('esbuild').version,inputFiles:Object.keys(result.metafile.inputs).length,scope:'Disposable Bob vault HTTP pilot bundle; credentials supplied at runtime on stdin'},null,2)+'\n');
console.log('Pilot bundle and digest written');
