// Golden fixture program for the Sentry .NET SDK. Run through capture-sdk.ts (see README.md).
using Sentry;

SentrySdk.Init(options =>
{
    options.Dsn = Environment.GetEnvironmentVariable("SENTRY_DSN");
    options.Release = "fixture-app@1.2.3";
    options.Environment = "production";
    options.ServerName = "fixture-host";
    options.AutoSessionTracking = false;
});

if (Environment.GetEnvironmentVariable("FIXTURE_SCENARIO") == "type-error")
{
    SentrySdk.ConfigureScope(scope =>
    {
        scope.SetTag("route", "/users/:id");
        scope.User = new SentryUser { Id = "user-42", Email = "ada@example.com" };
    });
    try
    {
        Profiles.Show("42");
    }
    catch (Exception error)
    {
        SentrySdk.CaptureException(error);
    }
}
else
{
    SentrySdk.CaptureMessage("Cache miss rate above 90% for key user:1234", SentryLevel.Warning);
}

await SentrySdk.FlushAsync(TimeSpan.FromSeconds(5));

static class Profiles
{
    static Dictionary<string, string> LoadUser(string id)
    {
        var users = new Dictionary<string, Dictionary<string, string>>();
        return users[id];
    }

    public static string Show(string id)
    {
        try
        {
            return LoadUser(id)["name"];
        }
        catch (KeyNotFoundException error)
        {
            throw new InvalidOperationException($"Failed to load user {id}", error);
        }
    }
}
