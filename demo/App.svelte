<script lang="ts">
	import { Button } from '@dorsk/tsumikit';
	import { Hmm } from '../src/index.ts';

	let open = $state(false);
</script>

<Button data-testid="host-open" onclick={() => (open = true)}>Tell us what you think</Button>
<output data-testid="host-state">{open ? 'open' : 'closed'}</output>
<Hmm projectKey="component" endpoint={location.origin} launcher={false} bind:open />
