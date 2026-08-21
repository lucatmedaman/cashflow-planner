import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * Eén dienst = één markdown-bestand. De frontmatter volgt het vaste stramien van
 * de detailpagina's; de markdown-body is de inleidende tekst.
 */
const diensten = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/diensten' }),
  schema: z.object({
    titel: z.string(),
    kort: z.string(),
    volgorde: z.number(),
    doelgroepen: z.array(z.string()),
    voorWie: z.string(),
    watWeDoen: z.array(z.string()),
    watUKrijgt: z.array(z.string()),
    methodologie: z.array(z.object({ label: z.string(), tekst: z.string() })),
    seo: z.string(),
  }),
});

export const collections = { diensten };
