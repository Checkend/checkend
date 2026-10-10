<?php
// Golden fixture program for the Sentry PHP SDK. Run through capture-sdk.ts (see README.md).
require getenv('DEPS') . '/vendor/autoload.php';

\Sentry\init([
    'dsn' => getenv('SENTRY_DSN'),
    'release' => 'fixture-app@1.2.3',
    'environment' => 'production',
    'server_name' => 'fixture-host',
    'default_integrations' => false,
]);

function loadUser(string $id): array
{
    $users = [];
    if (!isset($users[$id])) {
        throw new OutOfBoundsException("No user {$id}");
    }
    return $users[$id];
}

function showProfile(string $id): string
{
    try {
        return loadUser($id)['name'];
    } catch (OutOfBoundsException $error) {
        throw new RuntimeException("Failed to load user {$id}", 0, $error);
    }
}

if (getenv('FIXTURE_SCENARIO') === 'type-error') {
    \Sentry\configureScope(function (\Sentry\State\Scope $scope): void {
        $scope->setTag('route', '/users/:id');
        $scope->setUser(['id' => 'user-42', 'email' => 'ada@example.com']);
    });
    try {
        showProfile('42');
    } catch (Throwable $error) {
        \Sentry\captureException($error);
    }
} else {
    \Sentry\captureMessage('Cache miss rate above 90% for key user:1234', \Sentry\Severity::warning());
}

\Sentry\SentrySdk::getCurrentHub()->getClient()?->flush();
