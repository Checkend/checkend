# Golden fixture program for the Sentry Python SDK. Run through capture-sdk.ts (see README.md).
import os

import sentry_sdk

sentry_sdk.init(
    dsn=os.environ["SENTRY_DSN"],
    release="fixture-app@1.2.3",
    environment="production",
    server_name="fixture-host",
    default_integrations=False,
    auto_enabling_integrations=False,
)


def load_user(user_id):
    users = {}
    return users[user_id]


def show_profile(user_id):
    try:
        return load_user(user_id)["name"]
    except KeyError as error:
        raise RuntimeError(f"Failed to load user {user_id}") from error


if os.environ["FIXTURE_SCENARIO"] == "type-error":
    sentry_sdk.set_tag("route", "/users/:id")
    sentry_sdk.set_user({"id": "user-42", "email": "ada@example.com"})
    try:
        show_profile("42")
    except Exception as error:
        sentry_sdk.capture_exception(error)
else:
    sentry_sdk.capture_message("Cache miss rate above 90% for key user:1234", level="warning")

sentry_sdk.flush(5)
