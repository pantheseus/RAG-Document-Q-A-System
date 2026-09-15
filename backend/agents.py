from typing import TypedDict
from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
import os

# Define the state passed between agents
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
    # Initialize the Groq LLM
    llm = ChatGroq(model="groq/compound", temperature=0.1)

    # ==========================================
    # AGENT 1: The Researcher
    # ==========================================
    async def researcher_node(state: AgentState):
        """The Researcher searches the vector database for relevant information."""
        question = state["question"]
        docs = await retriever.ainvoke(question)
        
        context_parts = []
        sources_list = []
        
        for doc in docs:
            context_parts.append(doc.page_content)
            
            source_file = doc.metadata.get("source", "Unknown")
            filename = os.path.basename(source_file)
            page = doc.metadata.get("page")
            
            citation = filename
            if page is not None and page != "":
                try:
                    page_num = int(page) + 1  # PyPDFLoader is 0-indexed
                    citation += f" (Page {page_num})"
                except (ValueError, TypeError):
                    citation += f" (Page {page})"
                
            if citation not in sources_list:
                sources_list.append(citation)
                
        context = "\n\n".join(context_parts)
        
        if not context.strip():
            context = "No relevant passages found in the uploaded documents."
            
        return {"context": context, "sources": sources_list}

    # ==========================================
    # AGENT 2: The Executive Analyst / Editor
    # ==========================================
    async def editor_node(state: AgentState):
        """The Analyst synthesizes raw retrieved context into an executive answer."""
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You are an executive Document Intelligence Analyst. "
                       "The user will ask questions about their uploaded document (PDF/TXT). Relevant passages from their document are provided below under 'Context from Database'. "
                       "Your objective is to answer the user's question with direct, clear, and professional precision based strictly on the provided context.\n\n"
                       "CRITICAL OUTPUT RULE: Directly output the final structured response. "
                       "DO NOT output internal thinking outlines, reasoning steps, chain-of-thought summaries, or headers like 'Reasoning Process'. "
                       "Begin immediately with the answer.\n\n"
                       "LANGUAGE RULE: Detect the language of the user's question and respond ENTIRELY in that exact language (e.g. English, Tamil, Hindi, Spanish, French).\n\n"
                       "FORMATTING RULE: Use clean Markdown. Use bold text for key metrics/terms, organized bullet points for lists, and concise headings. "
                       "If code or technical commands are included, wrap them in triple-backtick (```) code blocks."),
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
    
    # Add nodes
    workflow.add_node("researcher", researcher_node)
    workflow.add_node("editor", editor_node)
    
    # Define execution graph: Start -> Researcher -> Editor -> End
    workflow.set_entry_point("researcher")
    workflow.add_edge("researcher", "editor")
    workflow.add_edge("editor", END)
    
    # Compile graph
    app = workflow.compile()
    return app
