// [claude-opus-4.7] 2026-04-24: agent-layer public surface (Task #48 Fase 2).
// Contrato: docs/contracts-task48.md
//
// Pipeline esperado (cuando USE_NEW_PIPELINE=true):
//   user msg
//     → runRouter({message, history, state}) → { intent, needs_knowledge, knowledge_query, skill, wants_affiliation }
//     → si needs_knowledge: queryKnowledge(knowledge_query) → snippets
//     → si intent === 'skill' && skill: invokeSkill(skill, ...) y saltar Generator
//     → runGenerator({intent, knowledge, history, state, message}) → { reply, wants_affiliation }
//     → runEvaluator({reply, context}) → { score, reasons, passes }
//     → si !passes && retries<1: regenerar 1 vez
//     → saveTrainingExample(chatId, userMsg, reply, score, reason)
//
// Las funciones queryKnowledge / saveTrainingExample / getEvaluatorScore las provee OpenCode
// en feat/knowledge-layer. Acá sólo exportamos la capa de agents.

export { runRouter } from './router.js'
export { runGenerator } from './generator.js'
export { runEvaluator, parseEvaluatorReply } from './evaluator.js'
