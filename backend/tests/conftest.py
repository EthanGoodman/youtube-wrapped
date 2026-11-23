

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

TEST_TOKEN = "test-token-0123456789abcdef0123456789abcdef"


def make_client(app) -> TestClient:
    """A client that talks to the app like its own page: localhost Host header + the install token."""
    return TestClient(app, base_url="http://127.0.0.1", headers={"X-Wrapped-Token": app.state.token})


@pytest.fixture(autouse=True, scope="session")
def _no_token_file():
    """Tests never create data/.app_token: every app gets a fixed test token (session-wide, so
    module-scoped fixtures that build an app are covered too)."""
    from ytw import security
    mp = pytest.MonkeyPatch()
    mp.setattr(security, "load_or_create_token", lambda path: TEST_TOKEN)
    yield
    mp.undo()
