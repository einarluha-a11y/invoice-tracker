#!/bin/bash
set -a; source .env.pipeline; set +a
node perplexity_agent.mjs
