<script lang="ts">
	
</script>

<style>
    .container {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-width: 300px;
        margin: 0 auto;
        border-color: var(--border-color, var(--wa-color-surface-border));
        border-radius: var(--wa-panel-border-radius);
        border-style: var(--wa-panel-border-style);
        border-width: var(--wa-panel-border-width);
        padding: var(--wa-space-l);
    }
</style>

<div class="container">
    <wa-input name="email" label="Email" type="email"></wa-input>
    <wa-input name="password" label="Password" type="password" password-toggle></wa-input>
    <wa-button type="submit">Sign In</wa-button>
</div>

