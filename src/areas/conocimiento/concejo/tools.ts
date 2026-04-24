import { storeMemory } from '../../../memory/vector-store.js';

type CouncilMember = {
  id: string;
  name: string;
  area: string;
  lens: string;
  focus: string[];
  risks: string[];
  planTrack: string;
  keyQuestions: string[];
};

const COUNCIL_MEMBERS: CouncilMember[] = [
  {
    id: 'librarian',
    name: 'Librarian',
    area: 'conocimiento',
    lens: 'preserva contexto, decisiones previas, dependencias y trazabilidad del conocimiento',
    focus: ['memoria institucional', 'reglas de negocio', 'fuentes de verdad'],
    risks: ['decidir sin contexto', 'duplicar conocimiento', 'olvidar decisiones previas'],
    planTrack: 'contexto y definiciones',
    keyQuestions: [
      'Que conocimiento ya existe y debe respetarse?',
      'Que definiciones, conceptos o reglas se deben formalizar?',
    ],
  },
  {
    id: 'architect',
    name: 'Architect',
    area: 'ingenieria',
    lens: 'asegura coherencia estructural, ubicacion correcta del cambio y compatibilidad con la arquitectura',
    focus: ['modulos impactados', 'fronteras entre dominios', 'decisiones de arquitectura'],
    risks: ['acoplamiento indebido', 'duplicacion de responsabilidades', 'deuda tecnica estructural'],
    planTrack: 'arquitectura y alcance',
    keyQuestions: [
      'En que modulo o area debe vivir la solucion?',
      'Que dependencias y fronteras no debemos romper?',
    ],
  },
  {
    id: 'backend',
    name: 'Backend',
    area: 'ingenieria',
    lens: 'aterriza la solucion en servicios, entidades, integraciones, seguridad y consistencia de datos',
    focus: ['APIs', 'persistencia', 'validaciones', 'flujos server-side'],
    risks: ['inconsistencia de datos', 'migraciones incompletas', 'casos borde no cubiertos'],
    planTrack: 'backend y datos',
    keyQuestions: [
      'Que contratos, DTOs o tablas deben cambiar?',
      'Como mantenemos consistencia y observabilidad?',
    ],
  },
  {
    id: 'frontend',
    name: 'Frontend',
    area: 'ingenieria',
    lens: 'traduce el problema a experiencia de usuario, rutas, estados y feedback operacional',
    focus: ['UI', 'flujo del usuario', 'errores', 'adopcion del cambio'],
    risks: ['flujo confuso', 'carga cognitiva', 'desalineacion entre UI y backend'],
    planTrack: 'experiencia y adopcion',
    keyQuestions: [
      'Que ve y hace exactamente el usuario?',
      'Que estados, mensajes o validaciones necesita la interfaz?',
    ],
  },
  {
    id: 'devops',
    name: 'DevOps',
    area: 'ingenieria',
    lens: 'valida despliegue, infraestructura, seguridad operativa, monitoreo y continuidad',
    focus: ['infraestructura', 'variables de entorno', 'docker', 'operacion'],
    risks: ['dependencias faltantes', 'rollout inseguro', 'falta de monitoreo'],
    planTrack: 'infraestructura y rollout',
    keyQuestions: [
      'Que necesita el entorno para correr esto?',
      'Como se despliega, monitorea y revierte el cambio?',
    ],
  },
  {
    id: 'pm',
    name: 'PM',
    area: 'producto',
    lens: 'convierte el problema en alcance, secuencia, entregables y criterios de aceptacion',
    focus: ['priorizacion', 'roadmap', 'entregables', 'riesgo de alcance'],
    risks: ['scope creep', 'entregables ambiguos', 'falta de criterio de cierre'],
    planTrack: 'plan de ejecucion',
    keyQuestions: [
      'Cual es el problema exacto y que resultado medible esperamos?',
      'Cual es la secuencia minima para entregar valor?',
    ],
  },
  {
    id: 'qa',
    name: 'QA',
    area: 'producto',
    lens: 'busca fallos, regresiones, vacios de validacion y cobertura faltante',
    focus: ['casos criticos', 'regresion', 'aceptacion', 'smoke tests'],
    risks: ['regresiones silenciosas', 'faltan pruebas end-to-end', 'supuestos no verificados'],
    planTrack: 'validacion y riesgos',
    keyQuestions: [
      'Que puede romperse?',
      'Que pruebas confirman que la solucion realmente funciona?',
    ],
  },
  {
    id: 'sales',
    name: 'Sales B2B',
    area: 'comercial',
    lens: 'mide impacto comercial, narrativa de valor, objeciones y segmentacion',
    focus: ['propuesta de valor', 'personas', 'objeciones', 'adopcion comercial'],
    risks: ['mensaje debil', 'valor no demostrable', 'solucion dificil de vender'],
    planTrack: 'narrativa y monetizacion',
    keyQuestions: [
      'Que valor percibe el cliente y para quien?',
      'Que objeciones apareceran al presentar esta solucion?',
    ],
  },
  {
    id: 'pricing',
    name: 'Pricing',
    area: 'comercial',
    lens: 'evalua paquete, limites, monetizacion y posicionamiento',
    focus: ['planes', 'empaquetado', 'upsell', 'restricciones'],
    risks: ['canibalizacion', 'pricing incoherente', 'limites mal definidos'],
    planTrack: 'packaging y pricing',
    keyQuestions: [
      'Esto pertenece a un plan base, addon o tier superior?',
      'Que limite o condicion comercial debe existir?',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    area: 'comercial',
    lens: 'prioriza aprendizaje, conversion, adopcion y medicion de impacto',
    focus: ['funnel', 'activacion', 'metricas', 'experimentos'],
    risks: ['sin medicion', 'sin activacion', 'sin feedback loop'],
    planTrack: 'adopcion y metricas',
    keyQuestions: [
      'Como medimos si esto mejora el negocio?',
      'Que experimento o instrumento de medicion hace falta?',
    ],
  },
  {
    id: 'logistics',
    name: 'Logistics',
    area: 'operaciones',
    lens: 'aterriza la solucion al flujo operativo real, tiempos, handoffs y excepciones',
    focus: ['flujo operativo', 'actores reales', 'costos', 'excepciones'],
    risks: ['friccion operativa', 'trabajo manual extra', 'casos no resueltos en campo'],
    planTrack: 'operacion real',
    keyQuestions: [
      'Como se ejecuta esto en la operacion diaria?',
      'Que excepciones o desbordes deben tener tratamiento explicito?',
    ],
  },
];

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectMembers(includeAgents?: string[], maxPerspectives?: number): CouncilMember[] {
  const requested = normalizeStringList(includeAgents).map((item) => item.toLowerCase());
  const filtered = requested.length > 0
    ? COUNCIL_MEMBERS.filter((member) => requested.includes(member.id.toLowerCase()) || requested.includes(member.name.toLowerCase()))
    : COUNCIL_MEMBERS;

  const limit = typeof maxPerspectives === 'number' && maxPerspectives > 0
    ? maxPerspectives
    : filtered.length;

  return filtered.slice(0, limit);
}

function buildOpinion(member: CouncilMember, args: any) {
  const constraints = normalizeStringList(args.constraints);
  const desiredOutcome = args.desired_outcome
    ? `Resultado esperado: ${args.desired_outcome}.`
    : 'Resultado esperado: una solucion integral, ejecutable y medible.';

  const constraintText = constraints.length > 0
    ? `Restricciones declaradas: ${constraints.join(', ')}.`
    : 'Restricciones declaradas: ninguna explicita, validar presupuesto, tiempo y dependencias.';

  return {
    member_id: member.id,
    member_name: member.name,
    area: member.area,
    perspective: member.lens,
    diagnosis:
      `Desde ${member.area}, ${member.name} ve el problema como un tema de ${member.focus.join(', ')} aplicado a: ${args.problem}.`,
    priorities: member.focus,
    main_risks: member.risks.map((risk) => `${risk} frente a ${args.problem}`),
    recommendation:
      `${member.name} recomienda abordar primero ${member.planTrack}, definiendo decisiones explicitas antes de ejecutar cambios irreversibles.`,
    questions: member.keyQuestions,
    framing: `${desiredOutcome} ${constraintText}`,
  };
}

function buildIntegratedPlan(args: any, participants: CouncilMember[]) {
  const uniqueTracks = Array.from(new Set(participants.map((member) => member.planTrack)));

  return {
    problem: args.problem,
    target_outcome: args.desired_outcome || 'resolver el problema con un plan integral',
    workstreams: uniqueTracks.map((track, index) => ({
      order: index + 1,
      track,
      objective: `Resolver el frente de ${track} para el problema planteado.`,
    })),
    immediate_actions: [
      `Definir el alcance exacto del problema: ${args.problem}`,
      'Alinear definiciones, reglas de negocio y restricciones',
      'Separar cambios en arquitectura, implementacion, adopcion y operacion',
      'Definir criterio de exito y validaciones antes de ejecutar',
    ],
  };
}

export const tools = {
  council_convene: {
    description:
      '[Concejo] Convoke the Novalogic council to analyze a specific problem from multiple specialized perspectives and return an integrated plan.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        problem: {
          type: 'string',
          description: 'Specific problem or decision to evaluate',
        },
        context: {
          type: 'string',
          description: 'Optional operational or product context',
        },
        desired_outcome: {
          type: 'string',
          description: 'What a good result should look like',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Budget, time, legal, technical or business constraints',
        },
        include_agents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional subset of council members to include',
        },
        max_perspectives: {
          type: 'number',
          description: 'Optional max number of perspectives to return',
        },
        persist_memory: {
          type: 'boolean',
          description: 'Store the council session as memory (default false)',
        },
      },
      required: ['problem'],
    },
    handler: async (args: any) => {
      const participants = selectMembers(args.include_agents, args.max_perspectives);
      if (participants.length === 0) {
        return {
          error: 'No council members matched the requested filter.',
          available_members: COUNCIL_MEMBERS.map((member) => member.id),
        };
      }

      const opinions = participants.map((member) => buildOpinion(member, args));
      const tensions = [
        'Velocidad de entrega vs robustez tecnica',
        'Valor comercial inmediato vs deuda operativa futura',
        'Flexibilidad del proceso vs estandarizacion controlada',
      ];
      const integratedPlan = buildIntegratedPlan(args, participants);

      let memoryId: number | null = null;
      if (args.persist_memory === true) {
        const summary = [
          `Problema: ${args.problem}`,
          args.context ? `Contexto: ${args.context}` : null,
          args.desired_outcome ? `Resultado esperado: ${args.desired_outcome}` : null,
          `Participantes: ${participants.map((member) => member.name).join(', ')}`,
          `Tracks: ${integratedPlan.workstreams.map((track) => track.track).join(', ')}`,
        ]
          .filter(Boolean)
          .join('\n');

        memoryId = await storeMemory({
          agent: 'concejo',
          category: 'workflow',
          title: `Concejo: ${args.problem}`,
          content: summary,
          tags: ['concejo', 'multi-agent', ...participants.map((member) => member.id)],
          metadata: {
            context: args.context || null,
            desired_outcome: args.desired_outcome || null,
            participant_count: participants.length,
          },
        });
      }

      return {
        council: 'Novalogic Concejo',
        topic: args.problem,
        context: args.context || null,
        participants: participants.map((member) => ({
          id: member.id,
          name: member.name,
          area: member.area,
          lens: member.lens,
        })),
        opinions,
        tensions,
        integrated_plan: integratedPlan,
        persisted_memory_id: memoryId,
      };
    },
  },
};
