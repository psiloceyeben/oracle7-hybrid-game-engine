// Relational substrate — concept-to-concept HRR bindings.
//
// Each entry is a concept with role-bound relational neighbors. At inference
// time, when a concept appears in response_state, the substrate can unbind
// its relational neighbors to ground the model's output in broader semantic
// context. This is what gives the Oracle the ability to say "X is similar
// to Y, contrasts with Z" rather than just "X exists."
//
// The library is curated text — synonyms-style — and substrate signatures
// regenerate on first cold load via lazy generation. ~100 starter entries
// span substrate-paradigm core concepts plus connector concepts bridging
// to math, ML, philosophy, biology, art.

import { ComplexVec, DIM, osubSeedSync, centroid } from "./substrate.js";

export type RelationKind =
  | "is_a"           // hypernym  ("substrate_paradigm is a computational_paradigm")
  | "kind_of"        // hyponym
  | "analogous_to"   // similar but distinct ("HRR analogous_to tensor_product")
  | "contrasts_with" // opposite or alternative
  | "instantiates"   // realizes a more abstract thing
  | "motivated_by"   // why it exists
  | "requires"       // depends on
  | "produces"       // outputs
  | "composes_with"; // can combine with

export interface RelationalEntry {
  concept: string;
  relations: Partial<Record<RelationKind, string[]>>;
  description?: string;
}

// ── Starter library: substrate-paradigm + cross-domain bridges ─────

export const RELATIONAL_LIBRARY: RelationalEntry[] = [
  // Substrate-paradigm core
  {
    concept: "substrate_paradigm",
    relations: {
      is_a: ["computational_paradigm", "compositional_algebra"],
      analogous_to: ["category_theory", "set_theory_with_morphisms", "process_algebra"],
      contrasts_with: ["attention_transformer", "gradient_descent_alone", "monolithic_model"],
      motivated_by: ["Fodor_rejection", "expression_not_translation", "cost_decoupling"],
      composes_with: ["HRR_binding", "recursive_nesting", "electricity_cost_scaling"],
    },
    description: "computational paradigm where capability accrues via compositional binding rather than parameter growth",
  },
  {
    concept: "HRR_binding",
    relations: {
      is_a: ["vector_symbolic_architecture", "complex_unit_phase_operation"],
      analogous_to: ["tensor_product", "circular_convolution", "outer_product_compressed"],
      contrasts_with: ["one_hot_encoding", "learned_embedding_lookup"],
      produces: ["bound_state_vector", "role_filler_representation"],
      composes_with: ["substrate_paradigm", "associative_memory", "cleanup_iteration"],
    },
    description: "circular convolution of two complex unit-phase vectors producing a third that recovers either factor via unbinding",
  },
  {
    concept: "scope_coherence",
    relations: {
      is_a: ["inference_time_shaping", "multi_scale_constraint"],
      analogous_to: ["hierarchical_attention", "multi_resolution_analysis"],
      requires: ["phrase_state", "sentence_state", "paragraph_state", "response_state"],
      produces: ["readout_alignment_across_scales"],
    },
    description: "enforcing that next-token candidates cohere with substrate signatures accumulated at phrase, sentence, paragraph, and response scales",
  },
  {
    concept: "dynamic_aperture",
    relations: {
      is_a: ["readout_parameterization", "substrate_aware_sampling"],
      contrasts_with: ["fixed_temperature_sampling", "static_top_k"],
      requires: ["substrate_confidence_signal", "entropy_of_top_k_distribution"],
      produces: ["per_step_T_and_k", "calibrated_readout"],
    },
    description: "per-step T and k values computed from the model's intrinsic uncertainty at that step",
  },
  {
    concept: "compositional_geometry",
    relations: {
      is_a: ["3d_structure_generation", "op_tree_projection"],
      analogous_to: ["procedural_modeling", "constructive_solid_geometry"],
      requires: ["atom_primitives", "composer_operators", "modifier_palette"],
      produces: ["renderable_meshes", "savable_op_trees", "multiplayer_replicable_state"],
    },
  },
  // Bridges to ML / CS
  {
    concept: "transformer",
    relations: {
      is_a: ["neural_architecture", "attention_based_model"],
      analogous_to: ["recurrent_network_replacement", "set_processor"],
      contrasts_with: ["substrate_paradigm", "symbolic_reasoning"],
      produces: ["language_model", "encoder_decoder"],
    },
  },
  {
    concept: "attention_mechanism",
    relations: {
      is_a: ["weighted_aggregation", "soft_addressing"],
      analogous_to: ["soft_lookup", "differentiable_dictionary"],
      contrasts_with: ["hard_routing", "discrete_dispatch"],
    },
  },
  {
    concept: "category_theory",
    relations: {
      is_a: ["mathematical_framework", "abstract_algebra"],
      analogous_to: ["substrate_paradigm", "type_theory"],
      composes_with: ["functional_programming", "homotopy_theory"],
    },
  },
  // Bridges to philosophy
  {
    concept: "Wittgenstein_position",
    relations: {
      is_a: ["philosophy_of_language", "anti_mentalese"],
      contrasts_with: ["Fodor_position", "language_of_thought_hypothesis"],
      motivated_by: ["private_language_argument", "meaning_as_use"],
    },
    description: "late Wittgenstein's view that inner experience cannot be ostensively defined apart from language",
  },
  {
    concept: "Fodor_position",
    relations: {
      is_a: ["philosophy_of_mind", "mentalese_hypothesis"],
      contrasts_with: ["Wittgenstein_position", "substrate_paradigm"],
      motivated_by: ["compositionality_of_thought", "productivity_of_language"],
    },
  },
  // Architecture concepts
  {
    concept: "gothic",
    relations: {
      is_a: ["architectural_style", "medieval_aesthetic"],
      analogous_to: ["pointed_arch_design", "vertical_emphasis"],
      contrasts_with: ["romanesque", "modernist", "classical"],
      produces: ["cathedral", "wizard_tower", "soaring_structure"],
      composes_with: ["stained_glass", "flying_buttress", "rose_window", "lancet_window"],
    },
  },
  {
    concept: "classical",
    relations: {
      is_a: ["architectural_style", "ancient_aesthetic"],
      analogous_to: ["greek_and_roman_revival", "humanist_proportion"],
      contrasts_with: ["gothic", "modernist", "industrial"],
      produces: ["temple", "colonnade", "pediment"],
      composes_with: ["doric", "ionic", "corinthian", "marble", "column"],
    },
  },
  {
    concept: "modernist",
    relations: {
      is_a: ["architectural_style", "20th_century_aesthetic"],
      analogous_to: ["form_follows_function", "minimal_decoration"],
      contrasts_with: ["gothic", "baroque", "classical"],
      composes_with: ["glass", "steel", "concrete", "open_plan"],
    },
  },
  // Game-mechanic concepts
  {
    concept: "survival_loop",
    relations: {
      is_a: ["gameplay_pattern", "resource_management"],
      analogous_to: ["mmorpg_grind", "city_builder_loop"],
      contrasts_with: ["creative_sandbox", "puzzle_solving"],
      requires: ["hunger", "health", "crafting", "gathering"],
      composes_with: ["weather", "day_night", "permadeath"],
    },
  },
  {
    concept: "mmorpg",
    relations: {
      is_a: ["game_type", "persistent_world"],
      analogous_to: ["mmo", "open_world_rpg"],
      contrasts_with: ["roguelike", "puzzle_game", "racing_game"],
      requires: ["multiplayer", "character_progression", "factions", "economy"],
    },
  },
  // Nature
  {
    concept: "forest",
    relations: {
      is_a: ["biome", "ecosystem"],
      analogous_to: ["woodland", "jungle"],
      contrasts_with: ["desert", "ocean", "tundra"],
      composes_with: ["trees", "undergrowth", "wildlife"],
      produces: ["wood", "shade", "habitat"],
    },
  },
  {
    concept: "mountain",
    relations: {
      is_a: ["terrain_feature", "elevation"],
      analogous_to: ["peak", "ridge"],
      contrasts_with: ["valley", "plain", "ocean"],
      composes_with: ["snow", "rock", "altitude"],
    },
  },
  // Visual styles
  {
    concept: "paper_mario_style",
    relations: {
      is_a: ["render_style", "flat_aesthetic"],
      analogous_to: ["papercraft", "construction_paper"],
      contrasts_with: ["photoreal", "voxel", "wireframe"],
      composes_with: ["unlit_shader", "saturated_palette", "flat_shadows"],
    },
  },
  {
    concept: "noir_style",
    relations: {
      is_a: ["render_style", "monochrome_aesthetic"],
      analogous_to: ["black_and_white_film", "high_contrast_photo"],
      contrasts_with: ["vaporwave", "pastel", "photoreal"],
      composes_with: ["high_contrast", "vignette", "film_grain", "sharp_shadows"],
    },
  },
  // Substrate library itself (meta)
  {
    concept: "relational_substrate",
    relations: {
      is_a: ["substrate_library", "concept_graph"],
      analogous_to: ["wordnet", "knowledge_graph", "semantic_network"],
      composes_with: ["substrate_paradigm", "HRR_binding"],
      produces: ["grounding_for_oracle_output", "definitional_coherence"],
    },
  },
];

// ── Indexed signature library ───────────────────────────────────────

interface RelationalIndex {
  conceptVecs: Map<string, ComplexVec>;        // concept -> signature
  roleVecs: Map<RelationKind, ComplexVec>;     // role -> signature
  // Bound (concept, role, neighbor) triples — for inference-time unbinding
  triples: Map<string, Array<{ role: RelationKind; neighbor: string; bound: ComplexVec }>>;
  description: Map<string, string>;
}

let _index: RelationalIndex | null = null;

function tokensFromName(name: string): string[] {
  return name.toLowerCase().split(/[_\-\s]+/).filter(Boolean);
}

function conceptCentroid(name: string): ComplexVec {
  const tokens = tokensFromName(name);
  return centroid(tokens.map(t => osubSeedSync(t)));
}

export function circularConv(a: ComplexVec, b: ComplexVec): ComplexVec {
  // Simple O(N^2) circular convolution. For DIM=1024 this is ~1M ops per
  // bind — fast enough at startup, cached after that.
  const re = new Float32Array(DIM);
  const im = new Float32Array(DIM);
  for (let k = 0; k < DIM; k++) {
    let rk = 0, ik = 0;
    for (let n = 0; n < DIM; n++) {
      const m = (k - n + DIM) % DIM;
      // (a[n].re + a[n].im * i) * (b[m].re + b[m].im * i)
      rk += a.re[n] * b.re[m] - a.im[n] * b.im[m];
      ik += a.re[n] * b.im[m] + a.im[n] * b.re[m];
    }
    re[k] = rk;
    im[k] = ik;
  }
  return { re, im };
}

export function buildRelationalIndex(): RelationalIndex {
  if (_index) return _index;
  const conceptVecs = new Map<string, ComplexVec>();
  const roleVecs = new Map<RelationKind, ComplexVec>();
  const triples = new Map<string, Array<{ role: RelationKind; neighbor: string; bound: ComplexVec }>>();
  const description = new Map<string, string>();
  // Build role vectors first
  for (const r of ["is_a","kind_of","analogous_to","contrasts_with","instantiates","motivated_by","requires","produces","composes_with"] as RelationKind[]) {
    roleVecs.set(r, conceptCentroid("role_" + r));
  }
  // Build concept vectors
  for (const entry of RELATIONAL_LIBRARY) {
    conceptVecs.set(entry.concept, conceptCentroid(entry.concept));
    if (entry.description) description.set(entry.concept, entry.description);
  }
  // Build triples (concept ⊗ role) bound with neighbor
  for (const entry of RELATIONAL_LIBRARY) {
    const out: Array<{ role: RelationKind; neighbor: string; bound: ComplexVec }> = [];
    for (const [role, neighbors] of Object.entries(entry.relations || {})) {
      const rVec = roleVecs.get(role as RelationKind);
      if (!rVec || !neighbors) continue;
      for (const n of neighbors) {
        if (!conceptVecs.has(n)) {
          conceptVecs.set(n, conceptCentroid(n));
        }
        const nVec = conceptVecs.get(n)!;
        // Bind: (concept ⊗ role) ⊗ neighbor — but we precompute (role ⊗ neighbor)
        // so unbinding from concept's signature recovers the neighbor.
        const bound = circularConv(rVec, nVec);
        out.push({ role: role as RelationKind, neighbor: n, bound });
      }
    }
    triples.set(entry.concept, out);
  }
  _index = { conceptVecs, roleVecs, triples, description };
  return _index;
}

// ── Public API ─────────────────────────────────────────────────────

export function getConcept(name: string): ComplexVec | undefined {
  return buildRelationalIndex().conceptVecs.get(name);
}

export function neighborsOf(concept: string, role?: RelationKind): Array<{ role: RelationKind; neighbor: string; description?: string }> {
  const idx = buildRelationalIndex();
  const triples = idx.triples.get(concept) || [];
  const filtered = role ? triples.filter(t => t.role === role) : triples;
  return filtered.map(t => ({
    role: t.role,
    neighbor: t.neighbor,
    description: idx.description.get(t.neighbor),
  }));
}

export function describeConcept(concept: string): string | undefined {
  return buildRelationalIndex().description.get(concept);
}

/** Compute a "relational halo" — the centroid of all neighbor vectors of
 *  the concept, weighted by role salience. Used to bias the substrate
 *  toward terms that relate to the active concept. */
export function relationalHalo(concept: string): ComplexVec | null {
  const idx = buildRelationalIndex();
  const triples = idx.triples.get(concept);
  if (!triples || triples.length === 0) return null;
  const neighborVecs: ComplexVec[] = [];
  for (const t of triples) {
    const nv = idx.conceptVecs.get(t.neighbor);
    if (nv) neighborVecs.push(nv);
  }
  if (neighborVecs.length === 0) return null;
  return centroid(neighborVecs);
}

/** List all known concepts in the relational library. */
export function listConcepts(): string[] {
  return Array.from(buildRelationalIndex().conceptVecs.keys()).sort();
}
