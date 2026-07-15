// Migrate all posts from a WordPress.com site into BlazorStatic markdown files.
//
// Usage:  node migrate-wordpress.mjs [--site kiranjoy.blog] [--force]
//
// - Reads posts from the public WordPress REST API (no login required).
// - Converts post HTML to Markdown (Turndown + GFM).
// - Downloads inline images into Content/Blog/media/<slug>/ and rewrites links.
// - Writes YAML front matter matching BlazorStatic's BlogFrontMatter.
//
// Re-runnable: existing .md files are skipped unless --force is passed.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ---- args ----------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const SITE = getArg("site", "kiranjoy.blog");
const FORCE = args.includes("--force");
const API = `https://public-api.wordpress.com/wp/v2/sites/${SITE}`;

const BLOG_DIR = path.join(repoRoot, "KiranJoy.Web", "Content", "Blog");
const MEDIA_DIR = path.join(BLOG_DIR, "media");

// ---- helpers -------------------------------------------------------------
const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
});
turndown.use(gfm);
// Keep <figure>/<figcaption> readable
turndown.addRule("figure", {
    filter: "figure",
    replacement: (content) => `\n\n${content}\n\n`,
});

function decodeEntities(str = "") {
    return str
        .replace(/&#8211;/g, "–")
        .replace(/&#8212;/g, "—")
        .replace(/&#8216;/g, "‘")
        .replace(/&#8217;/g, "’")
        .replace(/&#8220;/g, "“")
        .replace(/&#8221;/g, "”")
        .replace(/&#8230;/g, "…")
        .replace(/&#038;|&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#039;/g, "'")
        .replace(/&nbsp;/g, " ");
}

function stripHtml(html = "") {
    return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function yamlString(s = "") {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function fetchJson(url) {
    const res = await fetch(url, { headers: { "User-Agent": "kiranjoy-migrator" } });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.json();
}

async function fetchAllPosts() {
    const posts = [];
    for (let page = 1; ; page++) {
        const url = `${API}/posts?per_page=100&page=${page}&_embed=1&orderby=date&order=asc`;
        let batch;
        try {
            batch = await fetchJson(url);
        } catch (e) {
            // WordPress returns 400 once you page past the end
            break;
        }
        if (!Array.isArray(batch) || batch.length === 0) break;
        posts.push(...batch);
        if (batch.length < 100) break;
    }
    return posts;
}

function termSlugs(post) {
    const groups = post._embedded?.["wp:term"] ?? [];
    const slugs = [];
    for (const group of groups) {
        for (const term of group ?? []) {
            if (!term?.slug) continue;
            if (term.slug === "uncategorized") continue;
            slugs.push(term.slug);
        }
    }
    return [...new Set(slugs)];
}

async function downloadImage(url, destDir) {
    try {
        const clean = url.split("?")[0];
        let base = path.basename(clean) || "image";
        base = base.replace(/[^a-zA-Z0-9._-]/g, "-");
        if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(base)) base += ".jpg";
        const dest = path.join(destDir, base);
        const res = await fetch(url, { headers: { "User-Agent": "kiranjoy-migrator" } });
        if (!res.ok) throw new Error(`img ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.mkdir(destDir, { recursive: true });
        await fs.writeFile(dest, buf);
        return base;
    } catch (e) {
        console.warn(`   ! image failed ${url}: ${e.message}`);
        return null;
    }
}

// Replace image URLs in markdown with local relative paths.
async function localizeImages(markdown, slug) {
    const destDir = path.join(MEDIA_DIR, slug);
    const origin = `https://${SITE}`;
    // Capture any image URL (http(s), protocol-relative //, or root-relative /path)
    const imgRe = /!\[([^\]]*)\]\((\/\/[^)\s]+|https?:\/\/[^)\s]+|\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
    const matches = [...markdown.matchAll(imgRe)];
    for (const m of matches) {
        const [full, alt, rawUrl] = m;
        let url = rawUrl;
        if (url.startsWith("//")) url = "https:" + url;
        else if (url.startsWith("/")) url = origin + url;
        const file = await downloadImage(url, destDir);
        if (file) {
            markdown = markdown.replace(full, `![${alt}](media/${slug}/${file})`);
        }
    }
    return markdown;
}

// ---- main ----------------------------------------------------------------
async function main() {
    console.log(`Fetching posts from ${SITE} ...`);
    const posts = await fetchAllPosts();
    console.log(`Found ${posts.length} posts.\n`);

    await fs.mkdir(BLOG_DIR, { recursive: true });

    let written = 0, skipped = 0;
    for (const post of posts) {
        const slug = post.slug;
        const mdPath = path.join(BLOG_DIR, `${slug}.md`);

        if (!FORCE) {
            try { await fs.access(mdPath); skipped++; console.log(`- skip  ${slug} (exists)`); continue; } catch { }
        }

        const title = decodeEntities(post.title?.rendered ?? slug);
        const published = (post.date ?? "").slice(0, 10);
        const lead = stripHtml(post.excerpt?.rendered ?? "").slice(0, 240);
        const tags = termSlugs(post);

        let body = turndown.turndown(post.content?.rendered ?? "");
        body = await localizeImages(body, slug);
        body = body.replace(/\n{3,}/g, "\n\n").trim();

        const fm = [
            "---",
            `title: ${yamlString(title)}`,
            `lead: ${yamlString(lead)}`,
            `published: ${published}`,
            `tags: [${tags.join(", ")}]`,
            "authors:",
            '    - name: "Kiran Joy"',
            `---`,
            "",
            body,
            "",
        ].join("\n");

        await fs.writeFile(mdPath, fm, "utf8");
        written++;
        console.log(`+ write ${slug}.md  (${tags.length} tags)`);
    }

    console.log(`\nDone. ${written} written, ${skipped} skipped.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
