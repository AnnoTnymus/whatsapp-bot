// [claude-opus-4.7] 2026-04-24: scaffolding del agent-layer (Task #48).
// Implementaciones reales llegan cuando OpenCode commitee docs/contracts-task48.md.
//
// Exports esperados:
//   runRouter({ message, history, state }) → { intent, needs_knowledge, topic?, skill?, wants_affiliation }
//   runGenerator({ intent, knowledge, history, state }) → string (reply)
//   runEvaluator({ reply, context }) → { score, reasons, passes }
//
// Contrato definitivo: docs/contracts-task48.md (capa OpenCode).

module.exports = {
  runRouter: null,
  runGenerator: null,
  runEvaluator: null,
}
