import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = join(appRoot, 'dist')
const output = resolve(appRoot, '..', '..', 'showcase-uiux-prototype.html')
let html = readFileSync(join(distRoot, 'index.html'), 'utf8')
const script = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/)
const style = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/)
if (!script || !style) throw new Error('Vite 출력에서 CSS 또는 JavaScript 파일을 찾지 못했습니다.')

const asset = (url) => readFileSync(join(distRoot, url.replace(/^\//, '')), 'utf8')
const css = asset(style[1])
const js = asset(script[1])
if (/<\/script/i.test(js)) throw new Error('인라인 JavaScript에 닫는 script 태그가 있습니다.')
if (/<\/style/i.test(css)) throw new Error('인라인 CSS에 닫는 style 태그가 있습니다.')
html = html.replace(style[0], () => `<style>${css}</style>`)
html = html.replace(script[0], () => `<script type="module">${js}</script>`)
if ((html.match(/<\/script>/g) || []).length !== 1) throw new Error('단독 HTML의 script 닫는 태그 수가 올바르지 않습니다.')
html = html.replace('Showcase 시제품 v0.2', 'Showcase 시제품 v0.2 · 단독 HTML')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, html, 'utf8')
console.log(`단독 HTML 생성: ${output}`)
