Refactor the word delivery and review flow to prevent uncontrolled accumulation of user words while preserving meaningful interaction history.

Introduce a dynamic review gating mechanism where word delivery is conditional on the user’s current review load and unread/interacted state. Ensure that new words are not served when the user exceeds defined soft and hard review thresholds of 5 and 10 respectively, and instead trigger alternative engagement mechanisms such as motivational prompts or review nudges. The motivation prompts shouldn't be send through the webhook module, but the cron. Add more motivation messages to the existing ones, and make some of them encourage the user to use the "/review" handler

Modify the delivery pipeline so that words are only persisted to the user’s dataset after explicit interaction (e.g., viewing the definition). Evaluate and propose implementation approaches for this interaction-gated persistence, including any required buffering or schema adjustments, before proceeding.

Incorporate logic to track unread or unengaged words efficiently (consider caching or denormalized fields where appropriate) and use this signal to suppress further word delivery.

The periodic engagement features such as lightweight polls and contextual prompts should be tied to review behavior

Ensure all changes integrate cleanly with the existing schema and review scheduling logic, and identify any required additions or optimizations at the database level.  
