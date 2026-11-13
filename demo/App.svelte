<script lang="ts">
	import { Button } from '@dorsk/tsumikit';
	import { Hmm, HmmTrigger } from '../src/index.ts';

	let open = $state(false);
</script>

<Button data-testid="host-open" onclick={() => (open = true)}>Tell us what you think</Button>
<HmmTrigger data-testid="trigger" panel="top-right" />
<HmmTrigger look="link" data-testid="trigger-link">Something off? Tell us</HmmTrigger>
<output data-testid="host-state">{open ? 'open' : 'closed'}</output>
<Hmm projectKey="component" endpoint={location.origin} launcher={false} bind:open />
