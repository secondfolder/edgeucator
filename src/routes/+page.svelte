<script>
	let { data } = $props();
	let { colors } = $derived(data);
</script>

<div class="container">
    <header>
        <h1>Edgeucator</h1>
        <span class="subtitle">Your Edging Escort</span>
    </header>
    <a href="/guides">Guides</a>
</div>

<style>
    .container {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        min-height: 100svh;
        
        text-align: center;
        gap: 4em;
        
        header {
            h1 {
                font-size: 5rem;
                margin: 0;
            }
            .subtitle {
                font-size: 2rem;
                color: var(--wa-color-text-secondary);
            }
        }
    }
</style>
