from typing import TypedDict
from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
import os

# Define the state that will be passed between our agents
class AgentState(TypedDict):
    question: str
    context: str
    sources: list[str]
    final_answer: str

def create_multi_agent_system(retriever):
    """
    Creates a Multi-Agent workflow using LangGraph.
    Requires GROQ_API_KEY environment variable to be set.
    """
    # Initialize the Groq LLM (Smarter model for deep reasoning)
    llm = ChatGroq(model="groq/compound", temperature=0.1)

    # ==========================================
    # AGENT 1: The Researcher
    # ==========================================
    async def researcher_node(state: AgentState):
        """The Researcher searches the vector database for relevant information."""
        question = state["question"]
        print(f"[Agent: Researcher] Searching database for: {question}")
        docs = await retriever.ainvoke(question)
        
        context_parts = []
        sources_list = []
        
        for doc in docs:
            context_parts.append(doc.page_content)
            
            # Extract citation metadata
            source_file = doc.metadata.get("source", "Unknown")
            # Get just the filename instead of the full path
            filename = os.path.basename(source_file)
            page = doc.metadata.get("page")
            
            citation = filename
            if page is not None and page != "":
                try:
                    page_num = int(page) + 1 # PyPDFLoader is 0-indexed
                    citation += f" (Page {page_num})"
                except (ValueError, TypeError):
                    citation += f" (Page {page})"
                
            if citation not in sources_list:
                sources_list.append(citation)
                
        context = "\n\n".join(context_parts)
        
        if not context.strip():
            context = "No relevant information found in the document."
            
        return {"context": context, "sources": sources_list}

    # ==========================================
    # AGENT 2: The Editor
    # ==========================================
    async def editor_node(state: AgentState):
        """The Editor takes the raw facts and formats them beautifully."""
        print("[Agent: Editor] Drafting the final premium response...")
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You are a highly professional expert Editor and Analyst. "
                       "The user will ask questions about their uploaded document (PDF/TXT). The contents of their document are provided below as 'Context from Database'. "
                       "Your job is to answer the user's question accurately using ONLY this context. "
                       "If they ask a meta-question like 'explain my PDF' or 'summarize the document', treat the provided context as the document and summarize it for them. "
                       "\n\n"
                       "LANGUAGE RULE (HIGHEST PRIORITY): Detect the language the user wrote their question in and respond ENTIRELY in that same language. "
                       "For example: if the user writes in Tamil, respond in Tamil. If in Hindi, respond in Hindi. If in French, respond in French. "
                       "Never switch languages mid-response. Match the user's language exactly.\n\n"
                       "FORMATTING RULE: You MUST format your response beautifully using Markdown. "
                       "Always use bullet points for lists, bold text for key terms, and use headings where appropriate. "
                       "If your answer contains programming code, you MUST wrap it in triple backticks (```) so it formats line-by-line correctly.\n"
                       "Before giving your final answer, think deeply step-by-step about the context provided and what the user is asking. "
                       "Never output a single boring block of text. Break it up with paragraphs, lists, and code blocks."),
            ("human", "Context from Database:\n{context}\n\nUser Question: {question}")
        ])
        
        chain = prompt | llm
        response = await chain.ainvoke({
            "context": state["context"], 
            "question": state["question"]
        })
        return {"final_answer": response.content}

    # ==========================================
    # WORKFLOW GRAPH DEFINITION
    # ==========================================
    workflow = StateGraph(AgentState)
    
    # Add our agents as nodes
    workflow.add_node("researcher", researcher_node)
    workflow.add_node("editor", editor_node)
    
    # Define the flow: Start -> Researcher -> Editor -> End
    workflow.set_entry_point("researcher")
    workflow.add_edge("researcher", "editor")
    workflow.add_edge("editor", END)
    
    # Compile the graph
    app = workflow.compile()
    return app
