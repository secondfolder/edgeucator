<script>

	import LoginForm from "$lib/components/LoginForm.svelte";

</script>
<div class="container">
    <form method="POST" action="?/login">
        <LoginForm />
        <button formaction="?/signup">Sign up</button>
        <!-- <label>
            Email
            <input name="email" type="email" />
        </label>
        <label>
            Password
            <input name="password" type="password" />
        </label>
        <button>Login</button>
        <button formaction="?/signup">Sign up</button> -->
    </form>
</div>


<style>
    .container {
        form {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            justify-content: center;
            align-items: center;
            
        }
    }
</style>