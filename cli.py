import typer
from pathlib import Path

from incremental_index import run_incremental_index
from ask import ask_gemini

app = typer.Typer()


@app.command()
def index(repo_path: str = "."):
    """Index (or update) the current repository for question answering."""
    path = str(Path(repo_path).expanduser().resolve())
    typer.echo(f"Indexing: {path}")
    run_incremental_index(path)


@app.command()
def ask(question: str, repo_path: str = "."):
    """Ask a single question about the given repo."""
    path = str(Path(repo_path).expanduser().resolve())
    answer = ask_gemini(question, repo_path=path)
    typer.echo(f"\n{answer}\n")


@app.command()
def chat(repo_path: str = "."):
    """Start an interactive question session (like a copilot chat)."""
    path = str(Path(repo_path).expanduser().resolve())
    typer.echo(f"Chatting with repo: {path}")
    typer.echo("Type 'exit' to quit.\n")

    while True:
        question = typer.prompt(">")
        if question.strip().lower() in ("exit", "quit"):
            break
        answer = ask_gemini(question, repo_path=path)
        typer.echo(f"\n{answer}\n")


if __name__ == "__main__":
    app()