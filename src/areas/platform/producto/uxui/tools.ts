import { query } from '../../../../db/client.js';

export const tools = {
  uxui_get_design_system: {
    description: `[UX/UI Designer Agent] Get the full design system for a project — all design tokens organized by category (colors, typography, spacing, shadows, breakpoints, borders). Use this to understand the visual language before creating or reviewing any UI.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Project name (default: novalogic)',
        },
        category: {
          type: 'string',
          description:
            'Filter by category: colors, typography, spacing, breakpoints, shadows, borders',
        },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      let sql = 'SELECT * FROM design_tokens WHERE project = $1';
      const params: any[] = [project];

      if (args.category) {
        sql += ' AND category = $2';
        params.push(args.category);
      }
      sql += ' ORDER BY category, name';

      const result = await query(sql, params);

      // Group by category
      const grouped: Record<string, any[]> = {};
      for (const row of result.rows) {
        if (!grouped[row.category]) grouped[row.category] = [];
        grouped[row.category].push({
          name: row.name,
          value: row.value,
          css_variable: row.css_variable,
          description: row.description,
        });
      }

      return { project, tokens: grouped, total: result.rows.length };
    },
  },

  uxui_save_design_token: {
    description: `[UX/UI Designer Agent] Save or update a design token (color, font, spacing, etc.). Use to build and maintain the design system. Upserts by project+category+name.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        category: {
          type: 'string',
          description: 'Token category: colors, typography, spacing, breakpoints, shadows, borders',
        },
        name: { type: 'string', description: 'Token name (e.g., primary-500, heading-1, spacing-md)' },
        value: { type: 'string', description: 'Token value (e.g., #3B82F6, 2rem, 16px)' },
        css_variable: { type: 'string', description: 'CSS custom property name (e.g., --color-primary-500)' },
        description: { type: 'string', description: 'What this token is used for' },
        metadata: { type: 'object', description: 'Additional metadata (e.g., contrast ratio, font-weight)' },
      },
      required: ['category', 'name', 'value'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO design_tokens (project, category, name, value, css_variable, description, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (project, category, name)
         DO UPDATE SET value = $4, css_variable = $5, description = $6, metadata = $7, updated_at = NOW()
         RETURNING id`,
        [project, args.category, args.name, args.value, args.css_variable || null, args.description || null, args.metadata || {}],
      );
      return { success: true, id: result.rows[0].id, message: `Token ${args.category}/${args.name} saved` };
    },
  },

  uxui_bulk_save_tokens: {
    description: `[UX/UI Designer Agent] Save multiple design tokens at once. Efficient for initializing a full design system (colors palette, typography scale, spacing scale). Each token object needs: category, name, value. Optional: css_variable, description.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        tokens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              name: { type: 'string' },
              value: { type: 'string' },
              css_variable: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['category', 'name', 'value'],
          },
          description: 'Array of token objects to save',
        },
      },
      required: ['tokens'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      let saved = 0;
      for (const token of args.tokens) {
        await query(
          `INSERT INTO design_tokens (project, category, name, value, css_variable, description)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (project, category, name)
           DO UPDATE SET value = $4, css_variable = $5, description = $6, updated_at = NOW()`,
          [project, token.category, token.name, token.value, token.css_variable || null, token.description || null],
        );
        saved++;
      }
      return { success: true, saved, message: `${saved} tokens saved for ${project}` };
    },
  },

  uxui_get_component_guide: {
    description: `[UX/UI Designer Agent] Get component guidelines — usage rules, accessibility notes, props, variants, do/don't. Filter by component type (atom, molecule, organism, template) or get a specific component by name.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        name: { type: 'string', description: 'Specific component name' },
        component_type: {
          type: 'string',
          description: 'Filter by type: atom, molecule, organism, template, page',
        },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      let sql = 'SELECT * FROM design_components WHERE project = $1';
      const params: any[] = [project];
      let idx = 2;

      if (args.name) {
        sql += ` AND name ILIKE $${idx++}`;
        params.push(`%${args.name}%`);
      }
      if (args.component_type) {
        sql += ` AND component_type = $${idx++}`;
        params.push(args.component_type);
      }
      sql += ' ORDER BY component_type, name';

      const result = await query(sql, params);
      return { components: result.rows, count: result.rows.length };
    },
  },

  uxui_save_component_guide: {
    description: `[UX/UI Designer Agent] Save or update component guidelines. Defines how a UI component should be used, its variants, accessibility requirements, and do/don't rules. Upserts by project+name.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        name: { type: 'string', description: 'Component name (e.g., Button, Card, PricingTable)' },
        component_type: {
          type: 'string',
          description: 'Atomic design level: atom, molecule, organism, template, page',
        },
        description: { type: 'string', description: 'What this component does' },
        usage_guidelines: { type: 'string', description: 'When and how to use this component' },
        accessibility_notes: { type: 'string', description: 'ARIA roles, keyboard nav, contrast requirements' },
        props_schema: { type: 'object', description: 'Component props definition' },
        variants: {
          type: 'array',
          items: { type: 'object' },
          description: 'Visual/behavioral variants (e.g., [{name: "primary", description: "..."}])',
        },
        do_dont: {
          type: 'object',
          description: 'Do and dont rules: {do: ["..."], dont: ["..."]}',
        },
        figma_url: { type: 'string', description: 'Link to Figma design' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'component_type'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO design_components (project, name, component_type, description, usage_guidelines, accessibility_notes, props_schema, variants, do_dont, figma_url, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (project, name)
         DO UPDATE SET component_type = $3, description = $4, usage_guidelines = $5, accessibility_notes = $6, props_schema = $7, variants = $8, do_dont = $9, figma_url = $10, tags = $11, updated_at = NOW()
         RETURNING id`,
        [
          project, args.name, args.component_type,
          args.description || null, args.usage_guidelines || null, args.accessibility_notes || null,
          args.props_schema || {}, args.variants || [], args.do_dont || { do: [], dont: [] },
          args.figma_url || null, args.tags || [],
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Component guide '${args.name}' saved` };
    },
  },

  uxui_get_layout: {
    description: `[UX/UI Designer Agent] Get layout patterns for a page type (landing, dashboard, form, detail, list, auth, error). Returns section structure, responsive notes, and wireframe references.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        name: { type: 'string', description: 'Specific layout name' },
        page_type: { type: 'string', description: 'Filter by page type: landing, dashboard, form, detail, list, auth, error' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      let sql = 'SELECT * FROM design_layouts WHERE project = $1';
      const params: any[] = [project];
      let idx = 2;

      if (args.name) {
        sql += ` AND name ILIKE $${idx++}`;
        params.push(`%${args.name}%`);
      }
      if (args.page_type) {
        sql += ` AND page_type = $${idx++}`;
        params.push(args.page_type);
      }
      sql += ' ORDER BY page_type, name';

      const result = await query(sql, params);
      return { layouts: result.rows, count: result.rows.length };
    },
  },

  uxui_save_layout: {
    description: `[UX/UI Designer Agent] Save a layout pattern — defines the section structure and responsive behavior for a page type. Use for landing pages, dashboards, forms, etc.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        name: { type: 'string', description: 'Layout name (e.g., landing-home, dashboard-main)' },
        page_type: { type: 'string', description: 'Page type: landing, dashboard, form, detail, list, auth, error' },
        description: { type: 'string', description: 'Layout purpose' },
        sections: {
          type: 'array',
          items: { type: 'object' },
          description: 'Ordered list of sections: [{name, type, description, components, responsive}]',
        },
        responsive_notes: { type: 'string', description: 'Breakpoint behavior notes' },
        wireframe_url: { type: 'string', description: 'Link to wireframe' },
        metadata: { type: 'object' },
      },
      required: ['name', 'page_type', 'sections'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO design_layouts (project, name, page_type, description, sections, responsive_notes, wireframe_url, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (project, name)
         DO UPDATE SET page_type = $3, description = $4, sections = $5, responsive_notes = $6, wireframe_url = $7, metadata = $8
         RETURNING id`,
        [
          project, args.name, args.page_type,
          args.description || null, JSON.stringify(args.sections),
          args.responsive_notes || null, args.wireframe_url || null, args.metadata || {},
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Layout '${args.name}' saved` };
    },
  },

  uxui_check_accessibility: {
    description: `[UX/UI Designer Agent] Get accessibility checklist and guidelines for a component or page type. Returns WCAG 2.1 AA requirements, ARIA patterns, keyboard navigation rules, and contrast requirements relevant to the specified element.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        element_type: {
          type: 'string',
          description: 'Type of element to check: button, form, modal, navigation, table, image, video, carousel, pricing-table, hero, footer, header',
        },
      },
      required: ['element_type'],
    },
    handler: async (args: any) => {
      const a11yRules: Record<string, any> = {
        button: {
          wcag: ['2.1.1 Keyboard', '4.1.2 Name, Role, Value'],
          aria: ['Use <button> not <div>. role="button" only if unavoidable', 'aria-label for icon-only buttons', 'aria-disabled instead of disabled for visibility'],
          keyboard: ['Enter/Space to activate', 'Visible focus ring (min 2px)', 'Tab order logical'],
          contrast: ['Text: 4.5:1 ratio', 'Large text (18px+): 3:1', 'Focus indicator: 3:1'],
          do: ['Use semantic <button> element', 'Include visible text or aria-label', 'Show loading state for async actions'],
          dont: ['Don\'t use onClick on divs', 'Don\'t remove focus outline', 'Don\'t rely on color alone for state'],
        },
        form: {
          wcag: ['1.3.1 Info and Relationships', '3.3.1 Error Identification', '3.3.2 Labels'],
          aria: ['Every input needs a <label> or aria-label', 'aria-required for mandatory fields', 'aria-describedby for help text', 'aria-invalid + aria-errormessage for errors'],
          keyboard: ['Tab between fields', 'Enter to submit', 'Escape to cancel'],
          contrast: ['Input borders: 3:1 ratio', 'Placeholder text: 4.5:1', 'Error text: 4.5:1'],
          do: ['Group related fields with <fieldset>', 'Show inline validation errors', 'Announce errors to screen readers'],
          dont: ['Don\'t use placeholder as label', 'Don\'t disable paste on password fields', 'Don\'t auto-advance focus without warning'],
        },
        modal: {
          wcag: ['2.1.2 No Keyboard Trap', '2.4.3 Focus Order'],
          aria: ['role="dialog" + aria-modal="true"', 'aria-labelledby pointing to title', 'aria-describedby for content'],
          keyboard: ['Escape to close', 'Tab trapped inside modal', 'Focus returns to trigger on close'],
          contrast: ['Overlay must not obscure interactive content'],
          do: ['Trap focus inside modal', 'Return focus on close', 'Include a close button'],
          dont: ['Don\'t open modals without user action', 'Don\'t stack multiple modals'],
        },
        navigation: {
          wcag: ['2.4.1 Bypass Blocks', '2.4.5 Multiple Ways', '2.4.8 Location'],
          aria: ['<nav> with aria-label', 'aria-current="page" for active link', 'Mobile menu: aria-expanded'],
          keyboard: ['Skip link as first focusable element', 'Arrow keys for menu items', 'Escape to close dropdowns'],
          contrast: ['Links: 4.5:1 from background', 'Active state visually distinct'],
          do: ['Provide skip-to-content link', 'Highlight current page', 'Consistent navigation across pages'],
          dont: ['Don\'t use only icons without labels', 'Don\'t hide focus styles on nav links'],
        },
        'pricing-table': {
          wcag: ['1.3.1 Info and Relationships', '1.4.1 Use of Color'],
          aria: ['Use <table> or role="table" for structured data', 'aria-label for each plan column', 'Checkmarks need aria-label="Included" / "Not included"'],
          keyboard: ['All CTAs focusable', 'Logical tab order left to right'],
          contrast: ['Plan names: 4.5:1', 'Prices: 4.5:1', 'Feature checkmarks: 3:1'],
          do: ['Use semantic table markup', 'Provide text alternatives for checkmarks', 'Label the recommended plan explicitly'],
          dont: ['Don\'t use color alone to mark included/excluded', 'Don\'t hide pricing for screen readers'],
        },
        hero: {
          wcag: ['1.1.1 Non-text Content', '1.4.3 Contrast'],
          aria: ['Background images: decorative (aria-hidden)', 'CTA buttons: clear aria-label', 'Heading hierarchy: h1 for main title'],
          keyboard: ['CTA is first significant focus target', 'Skip link bypasses hero'],
          contrast: ['Text over image: 4.5:1 (use overlay)', 'CTA button: 4.5:1'],
          do: ['Use overlay on background images for text contrast', 'Single clear CTA', 'h1 for primary headline'],
          dont: ['Don\'t autoplay video backgrounds', 'Don\'t use multiple competing CTAs'],
        },
        header: {
          wcag: ['2.4.1 Bypass Blocks', '3.2.3 Consistent Navigation'],
          aria: ['<header> landmark', 'Logo link: aria-label="Home"', 'Mobile toggle: aria-expanded + aria-controls'],
          keyboard: ['Skip link first', 'Logo focusable', 'Tab through nav items'],
          contrast: ['All text and icons: 4.5:1'],
        },
        footer: {
          wcag: ['2.4.1 Bypass Blocks', '1.4.3 Contrast'],
          aria: ['<footer> landmark', 'Link groups: aria-label for each section'],
          keyboard: ['All links focusable', 'Tab order follows visual order'],
          contrast: ['Footer text (often lighter bg): still 4.5:1'],
        },
        table: {
          wcag: ['1.3.1 Info and Relationships'],
          aria: ['<th> with scope="col" or scope="row"', '<caption> for table title', 'Complex tables: aria-describedby'],
          keyboard: ['Arrow keys for cell navigation (in data grids)'],
        },
        image: {
          wcag: ['1.1.1 Non-text Content'],
          aria: ['Meaningful images: alt text', 'Decorative images: alt="" or aria-hidden="true"', 'Complex images: aria-describedby for long description'],
        },
        carousel: {
          wcag: ['2.2.2 Pause, Stop, Hide', '4.1.2 Name, Role, Value'],
          aria: ['role="region" with aria-label', 'aria-live="polite" for slide changes', 'Prev/Next: aria-label'],
          keyboard: ['Arrow keys for slides', 'Pause button accessible', 'Tab to interactive elements in current slide only'],
          do: ['Provide pause control', 'Show slide indicators', 'Allow keyboard navigation'],
          dont: ['Don\'t autoplay without pause option', 'Don\'t trap focus in carousel'],
        },
        video: {
          wcag: ['1.2.1 Captions', '1.2.5 Audio Description', '2.2.2 Pause'],
          aria: ['Player controls: labeled buttons', 'aria-label for custom controls'],
          keyboard: ['Space to play/pause', 'Arrow keys for seek', 'All controls focusable'],
        },
      };

      const rules = a11yRules[args.element_type];
      if (!rules) {
        return {
          element_type: args.element_type,
          error: `No specific rules for '${args.element_type}'. Available: ${Object.keys(a11yRules).join(', ')}`,
          general: {
            wcag_level: 'AA',
            key_principles: ['Perceivable', 'Operable', 'Understandable', 'Robust'],
            minimum_contrast: '4.5:1 for normal text, 3:1 for large text',
            keyboard: 'All interactive elements must be keyboard accessible',
          },
        };
      }

      return { element_type: args.element_type, wcag_level: 'AA', ...rules };
    },
  },
};
