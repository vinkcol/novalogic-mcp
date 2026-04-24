import { query } from '../../../db/client.js';

export const tools = {
  content_get_page: {
    description: `[Content & SEO Agent] Get page content — structured sections, copy, and status for a specific page or all pages. Returns the full content model for rendering landing pages, marketing pages, etc.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        page_slug: { type: 'string', description: 'Specific page slug (e.g., "home", "pricing", "features")' },
        status: { type: 'string', description: 'Filter by status: draft, review, published' },
        locale: { type: 'string', description: 'Locale (default: es)' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const locale = args.locale || 'es';
      let sql = 'SELECT * FROM content_pages WHERE project = $1 AND locale = $2';
      const params: any[] = [project, locale];
      let idx = 3;

      if (args.page_slug) {
        sql += ` AND page_slug = $${idx++}`;
        params.push(args.page_slug);
      }
      if (args.status) {
        sql += ` AND status = $${idx++}`;
        params.push(args.status);
      }
      sql += ' ORDER BY page_slug';

      const result = await query(sql, params);

      // Also fetch copy variants for each page
      if (args.page_slug && result.rows.length > 0) {
        const variants = await query(
          'SELECT * FROM content_copy_variants WHERE project = $1 AND page_slug = $2 AND locale = $3 ORDER BY section, variant_name',
          [project, args.page_slug, locale],
        );
        const seo = await query(
          'SELECT * FROM content_seo_config WHERE project = $1 AND page_slug = $2 AND locale = $3',
          [project, args.page_slug, locale],
        );

        return {
          page: result.rows[0],
          copy_variants: variants.rows,
          seo: seo.rows[0] || null,
        };
      }

      return { pages: result.rows, count: result.rows.length };
    },
  },

  content_save_page: {
    description: `[Content & SEO Agent] Save or update a page content structure. Defines the sections and their order for a page (hero, features, pricing, testimonials, cta, footer, etc.). Upserts by project+page_slug+locale.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        page_slug: { type: 'string', description: 'URL-safe page identifier (e.g., "home", "pricing")' },
        page_title: { type: 'string', description: 'Page display title' },
        description: { type: 'string', description: 'Page purpose/description' },
        sections: {
          type: 'array',
          items: { type: 'object' },
          description: 'Ordered sections: [{id, type, title, content, props}]',
        },
        status: { type: 'string', description: 'draft, review, published' },
        locale: { type: 'string', description: 'Locale (default: es)' },
        metadata: { type: 'object' },
      },
      required: ['page_slug', 'page_title', 'sections'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const locale = args.locale || 'es';
      const result = await query(
        `INSERT INTO content_pages (project, page_slug, page_title, description, sections, status, locale, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (project, page_slug, locale)
         DO UPDATE SET page_title = $3, description = $4, sections = $5, status = $6, metadata = $8, updated_at = NOW()
         RETURNING id`,
        [
          project, args.page_slug, args.page_title,
          args.description || null, JSON.stringify(args.sections),
          args.status || 'draft', locale, args.metadata || {},
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Page '${args.page_slug}' saved` };
    },
  },

  content_get_copy: {
    description: `[Content & SEO Agent] Get copy variants for a page section. Returns headlines, subheadlines, body text, and CTAs. Supports A/B testing with multiple variants per section.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        page_slug: { type: 'string', description: 'Page slug' },
        section: { type: 'string', description: 'Section identifier' },
        locale: { type: 'string', description: 'Locale (default: es)' },
      },
      required: ['page_slug'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const locale = args.locale || 'es';
      let sql = 'SELECT * FROM content_copy_variants WHERE project = $1 AND page_slug = $2 AND locale = $3';
      const params: any[] = [project, args.page_slug, locale];

      if (args.section) {
        sql += ' AND section = $4';
        params.push(args.section);
      }
      sql += ' ORDER BY section, variant_name';

      const result = await query(sql, params);
      return { variants: result.rows, count: result.rows.length };
    },
  },

  content_save_copy: {
    description: `[Content & SEO Agent] Save or update a copy variant for a page section. Defines headline, subheadline, body, CTA text and URL. Supports multiple variants per section for A/B testing. Upserts by project+page_slug+section+variant_name+locale.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        page_slug: { type: 'string', description: 'Page slug (e.g., "home")' },
        section: { type: 'string', description: 'Section ID (e.g., "hero", "features", "pricing")' },
        variant_name: { type: 'string', description: 'Variant name (default: "default")' },
        headline: { type: 'string', description: 'Main headline' },
        subheadline: { type: 'string', description: 'Supporting text' },
        body: { type: 'string', description: 'Body text / description' },
        cta_text: { type: 'string', description: 'Call to action button text' },
        cta_url: { type: 'string', description: 'CTA destination URL' },
        locale: { type: 'string', description: 'Locale (default: es)' },
        is_active: { type: 'boolean', description: 'Whether this variant is active (default: true)' },
      },
      required: ['page_slug', 'section'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const locale = args.locale || 'es';
      const variant = args.variant_name || 'default';
      const result = await query(
        `INSERT INTO content_copy_variants (project, page_slug, section, variant_name, headline, subheadline, body, cta_text, cta_url, locale, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (project, page_slug, section, variant_name, locale)
         DO UPDATE SET headline = $5, subheadline = $6, body = $7, cta_text = $8, cta_url = $9, is_active = $11
         RETURNING id`,
        [
          project, args.page_slug, args.section, variant,
          args.headline || null, args.subheadline || null, args.body || null,
          args.cta_text || null, args.cta_url || null,
          locale, args.is_active !== false,
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Copy for ${args.page_slug}/${args.section}/${variant} saved` };
    },
  },

  content_get_seo: {
    description: `[Content & SEO Agent] Get SEO configuration for a page — meta title, description, OG tags, keywords, structured data, robots directive, and SEO score with suggestions.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        page_slug: { type: 'string', description: 'Page slug (omit for all pages)' },
        locale: { type: 'string', description: 'Locale (default: es)' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const locale = args.locale || 'es';
      let sql = 'SELECT * FROM content_seo_config WHERE project = $1 AND locale = $2';
      const params: any[] = [project, locale];

      if (args.page_slug) {
        sql += ' AND page_slug = $3';
        params.push(args.page_slug);
      }
      sql += ' ORDER BY page_slug';

      const result = await query(sql, params);
      return { seo_configs: result.rows, count: result.rows.length };
    },
  },

  content_save_seo: {
    description: `[Content & SEO Agent] Save or update SEO configuration for a page. Sets meta tags, Open Graph, keywords, structured data (JSON-LD), and robots directive. Upserts by project+page_slug+locale.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        page_slug: { type: 'string', description: 'Page slug' },
        meta_title: { type: 'string', description: 'Meta title (max 60 chars recommended)' },
        meta_description: { type: 'string', description: 'Meta description (max 160 chars recommended)' },
        canonical_url: { type: 'string', description: 'Canonical URL' },
        og_title: { type: 'string', description: 'Open Graph title' },
        og_description: { type: 'string', description: 'Open Graph description' },
        og_image: { type: 'string', description: 'Open Graph image URL' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Target keywords' },
        structured_data: { type: 'object', description: 'JSON-LD structured data' },
        robots: { type: 'string', description: 'Robots directive (default: "index, follow")' },
        locale: { type: 'string', description: 'Locale (default: es)' },
      },
      required: ['page_slug', 'meta_title', 'meta_description'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const locale = args.locale || 'es';
      const result = await query(
        `INSERT INTO content_seo_config (project, page_slug, meta_title, meta_description, canonical_url, og_title, og_description, og_image, keywords, structured_data, robots, locale)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (project, page_slug, locale)
         DO UPDATE SET meta_title = $3, meta_description = $4, canonical_url = $5, og_title = $6, og_description = $7, og_image = $8, keywords = $9, structured_data = $10, robots = $11, updated_at = NOW()
         RETURNING id`,
        [
          project, args.page_slug,
          args.meta_title, args.meta_description,
          args.canonical_url || null,
          args.og_title || args.meta_title,
          args.og_description || args.meta_description,
          args.og_image || null,
          args.keywords || [],
          args.structured_data || {},
          args.robots || 'index, follow',
          locale,
        ],
      );
      return { success: true, id: result.rows[0].id, message: `SEO config for '${args.page_slug}' saved` };
    },
  },

  content_check_seo_score: {
    description: `[Content & SEO Agent] Analyze SEO quality for a page. Checks meta title length, meta description length, keyword presence, OG completeness, structured data, heading structure, and returns a score (0-100) with actionable suggestions.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        page_slug: { type: 'string', description: 'Page slug to analyze' },
        locale: { type: 'string', description: 'Locale (default: es)' },
      },
      required: ['page_slug'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const locale = args.locale || 'es';

      const seoResult = await query(
        'SELECT * FROM content_seo_config WHERE project = $1 AND page_slug = $2 AND locale = $3',
        [project, args.page_slug, locale],
      );

      const pageResult = await query(
        'SELECT * FROM content_pages WHERE project = $1 AND page_slug = $2 AND locale = $3',
        [project, args.page_slug, locale],
      );

      const copyResult = await query(
        'SELECT * FROM content_copy_variants WHERE project = $1 AND page_slug = $2 AND locale = $3 AND is_active = true',
        [project, args.page_slug, locale],
      );

      if (!seoResult.rows.length && !pageResult.rows.length) {
        return { score: 0, error: `No content or SEO config found for page '${args.page_slug}'` };
      }

      const seo = seoResult.rows[0];
      const page = pageResult.rows[0];
      const suggestions: string[] = [];
      let score = 0;
      const maxScore = 100;
      let checks = 0;
      let passed = 0;

      // Meta title checks
      checks++;
      if (seo?.meta_title) {
        passed++;
        if (seo.meta_title.length > 60) suggestions.push(`Meta title too long (${seo.meta_title.length}/60 chars) — may be truncated in search results`);
        else if (seo.meta_title.length < 30) suggestions.push(`Meta title too short (${seo.meta_title.length}/60 chars) — use more descriptive title`);
      } else {
        suggestions.push('Missing meta title — critical for SEO');
      }

      // Meta description checks
      checks++;
      if (seo?.meta_description) {
        passed++;
        if (seo.meta_description.length > 160) suggestions.push(`Meta description too long (${seo.meta_description.length}/160 chars)`);
        else if (seo.meta_description.length < 70) suggestions.push(`Meta description too short (${seo.meta_description.length}/160 chars)`);
      } else {
        suggestions.push('Missing meta description — important for click-through rate');
      }

      // Open Graph checks
      checks++;
      if (seo?.og_title && seo?.og_description) {
        passed++;
        if (!seo.og_image) suggestions.push('Missing OG image — social shares will lack visual appeal');
      } else {
        suggestions.push('Incomplete Open Graph tags — fill og_title and og_description for social sharing');
      }

      // Keywords
      checks++;
      if (seo?.keywords?.length > 0) {
        passed++;
        if (seo.keywords.length < 3) suggestions.push('Add more keywords (recommend 3-8 per page)');
      } else {
        suggestions.push('No keywords defined — add target keywords for this page');
      }

      // Structured data
      checks++;
      if (seo?.structured_data && Object.keys(seo.structured_data).length > 0) {
        passed++;
      } else {
        suggestions.push('No structured data (JSON-LD) — add Organization, WebPage, or Product schema');
      }

      // Canonical URL
      checks++;
      if (seo?.canonical_url) {
        passed++;
      } else {
        suggestions.push('No canonical URL set — recommended to prevent duplicate content issues');
      }

      // Page content checks
      checks++;
      if (page?.sections?.length > 0) {
        passed++;
      } else {
        suggestions.push('No page sections defined — page needs content structure');
      }

      // Copy variants
      checks++;
      if (copyResult.rows.length > 0) {
        passed++;
        const hasHeadlines = copyResult.rows.some((r: any) => r.headline);
        if (!hasHeadlines) suggestions.push('No headlines in copy variants — add compelling headlines for each section');
      } else {
        suggestions.push('No copy variants — add headline, subheadline, and body for each section');
      }

      score = Math.round((passed / checks) * maxScore);

      // Update score in DB
      if (seo) {
        await query(
          'UPDATE content_seo_config SET score = $1, suggestions = $2 WHERE id = $3',
          [score, JSON.stringify(suggestions), seo.id],
        );
      }

      return {
        page_slug: args.page_slug,
        score,
        max_score: maxScore,
        passed_checks: passed,
        total_checks: checks,
        rating: score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Needs Work' : 'Poor',
        suggestions,
      };
    },
  },

  content_get_all_pages_seo: {
    description: `[Content & SEO Agent] Get a summary of SEO status across all pages — scores, missing configs, and overall health. Useful for a bird's-eye view of content readiness.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        locale: { type: 'string', description: 'Locale (default: es)' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const locale = args.locale || 'es';

      const pages = await query(
        'SELECT page_slug, page_title, status FROM content_pages WHERE project = $1 AND locale = $2 ORDER BY page_slug',
        [project, locale],
      );

      const seoConfigs = await query(
        'SELECT page_slug, meta_title, score FROM content_seo_config WHERE project = $1 AND locale = $2',
        [project, locale],
      );

      const seoMap = new Map(seoConfigs.rows.map((r: any) => [r.page_slug, r]));

      const summary = pages.rows.map((page: any) => {
        const seo = seoMap.get(page.page_slug);
        return {
          page_slug: page.page_slug,
          page_title: page.page_title,
          status: page.status,
          has_seo: !!seo,
          seo_score: seo?.score || 0,
        };
      });

      // Pages with SEO but no content
      const pagesWithoutContent = seoConfigs.rows
        .filter((s: any) => !pages.rows.find((p: any) => p.page_slug === s.page_slug))
        .map((s: any) => ({ page_slug: s.page_slug, has_content: false, seo_score: s.score }));

      const avgScore = summary.length > 0
        ? Math.round(summary.reduce((s: number, p: any) => s + p.seo_score, 0) / summary.length)
        : 0;

      return {
        pages: [...summary, ...pagesWithoutContent],
        total_pages: summary.length + pagesWithoutContent.length,
        average_seo_score: avgScore,
        pages_without_seo: summary.filter((p: any) => !p.has_seo).length,
        pages_draft: summary.filter((p: any) => p.status === 'draft').length,
        pages_published: summary.filter((p: any) => p.status === 'published').length,
      };
    },
  },
};
