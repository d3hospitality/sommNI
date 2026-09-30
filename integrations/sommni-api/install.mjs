// Surgical installer for the existing API checkout; never overwrites changed code.
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
if (!root) throw new Error('Usage: node integrations/sommni-api/install.mjs /path/to/sommni-api');
const target = path.join(root, 'api/generate-bottle.js');
const helper = path.join(root, 'api/_lib/billing.js');
let code = fs.readFileSync(target, 'utf8');
const hook = "  if (!user || !rateLimit(req, res, { limit: 6 })) return;";
if (!code.includes(hook)) throw new Error('API handler changed. Review the billing hook before installing.');
const source = fs.readFileSync(new URL('./billing.js', import.meta.url));
if (fs.existsSync(helper) && !fs.readFileSync(helper).equals(source)) throw new Error('An existing billing helper differs. Review it before installing.');
if (!code.includes('await requireBottleStudioPro(req, res)')) {
  code = "import { requireBottleStudioPro } from './_lib/billing.js';\n" + code.replace(hook, hook + '\n  if (!await requireBottleStudioPro(req, res)) return;');
  fs.writeFileSync(target, code);
}
fs.writeFileSync(helper, source);
console.log('Installed Bottle Studio billing gate. Verify API Supabase environment and tests before deploying.');
