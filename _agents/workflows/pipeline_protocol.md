# Pipeline Protocol

Placeholder — будет заполнен Perplexity Agent после получения GitHub токена.

Протокол взаимодействия Claude ↔ Perplexity через GitHub:
- Claude пишет решение в `_agents/pipeline/SOLUTION.md`
- Perplexity читает, ревьюит, пишет замечания в `_agents/pipeline/REVIEW.md`
- Claude читает замечания, исправляет
- Статус пайплайна — `_agents/pipeline/STATUS.md`
