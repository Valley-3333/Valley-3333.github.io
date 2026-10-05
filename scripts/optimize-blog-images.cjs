// Run with Node.js and sharp installed, or with the bundled Codex Node.js runtime.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
let sharp;
try {
    sharp = require('sharp');
} catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    sharp = createRequire(process.execPath)('sharp');
}

const root = path.resolve(__dirname, '..');
const blogs = path.join(root, 'blogs');
const imageRoot = path.join(blogs, 'blog_pic');
const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

async function main() {
    const totals = {};
    for (const name of (await fs.readdir(blogs)).filter(name => /^blog\d+\.html$/.test(name))) {
        const filename = path.join(blogs, name);
        let html = await fs.readFile(filename, 'utf8');
        let imageIndex = 0;
        for (const match of [...html.matchAll(/<img\b[^>]*>/g)]) {
            const tag = match[0];
            const original = attribute(tag, 'data-original-src') || attribute(tag, 'src');
            if (!original?.startsWith('blog_pic/')) continue;
            const input = path.resolve(blogs, original);
            if (!input.startsWith(imageRoot + path.sep)) throw new Error(`Invalid image path: ${original}`);
            const metadata = await sharp(input).rotate().metadata();
            const originalWidth = metadata.autoOrient?.width || metadata.width;
            const classes = (attribute(tag, 'class') || '').split(/\s+/).filter(Boolean);
            if (!classes.includes('blog-img')) classes.unshift('blog-img');
            const displayWidth = classes.includes('blog-img--small') ? 300
                : classes.includes('blog-img--medium') ? 540 : 700;
            const widths = [...new Set([displayWidth, displayWidth * 2].map(width => Math.min(width, originalWidth)))];
            const outputDir = path.join(path.dirname(input), 'optimized');
            await fs.mkdir(outputDir, { recursive: true });
            const variants = [];
            for (const width of widths) {
                const output = path.join(outputDir, `${path.parse(input).name}-${width}.webp`);
                const result = await sharp(input).rotate()
                    .resize({ width, withoutEnlargement: true })
                    .webp({ quality: 85, effort: 6 }).toFile(output);
                variants.push({ url: path.relative(blogs, output).split(path.sep).join('/'), ...result });
            }
            const first = variants[0];
            const retained = tag.slice(4, -1).replace(/\s+(?:src|srcset|sizes|width|height|loading|decoding|data-original-src|class)="[^"]*"/g, '').trim();
            const replacement = `<img src="${first.url}" srcset="${variants.map(v => `${v.url} ${v.width}w`).join(', ')}" sizes="(max-width: ${displayWidth + 40}px) calc(100vw - 40px), ${displayWidth}px" ${retained} class="${classes.join(' ')}" width="${first.width}" height="${first.height}" loading="${imageIndex++ === 0 ? 'eager' : 'lazy'}" decoding="async" data-original-src="${original}">`;
            const precedingLink = html.slice(0, html.indexOf(tag)).match(/<a\b[^>]*>\s*$/)?.[0];
            html = html.replace(tag, precedingLink ? replacement
                : `<a class="blog-image-link" href="${original}" title="元の解像度で画像を開く">${replacement}</a>`);
            const total = totals[name] ||= { originalBytes: 0, standardBytes: 0, highDensityBytes: 0, images: 0 };
            total.originalBytes += (await fs.stat(input)).size;
            total.standardBytes += first.size;
            total.highDensityBytes += variants.at(-1).size;
            total.images++;
        }
        if (imageIndex) await fs.writeFile(filename, html, 'utf8');
    }
    console.log(JSON.stringify(totals, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
