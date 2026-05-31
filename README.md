# Clutch0

Clutch is a tool for using AI to write code.

Clutch tries to make AI coding feel more like driving a standard transmission. You issue the command for each next action rather than an agent loop, anachronistically involving you in tasks that could be automated so that you stay connected to what is happening.

Clutch puts you in the driver's seat, agent loops are just one of many tools. You issue natural language commands to edit files, run programs and tools, add files to context. You can save most things to the context window, so that later LLM calls will react to them.

For example:

- Add several files to context, and then ask to "Create a new module in this pattern, but for {new domain}"
- Ask an agent loop to gather info on every place a library is used, ask the LLM what you should do next, as you edit have the "what should we do next" generation update. So you always have a next step, you you save yourself the research, but you do the edits exactly as you would want them./pl
- Ask for an edit, save the diff to context rather than applying it, ask questions about that diff, save the answer to context, generate a new edit that takes this all in, and apply it.

## Some potential taglines

- AI coding where you are the agent
- A mech suit for the mind, to augment the drone swarm of agent loops

## Why?

Current AI coding tools have bad ergonomics for building human understanding. If Programming is Theory Building (and I strongly believe that it is), the tools should be designed for that, rather than being designed to vomit code.

_Has This Ever Happened To You?_
You are working with a coding agent, you understand the codebase super well, and have an idea of how to do it. You build a good plan, and start Gallumpivating. The first few agent actions make sense, but then it does something you don't expect. While you are trying to figure out why it did that, it does something else which is also surprising. You are totally lost, so you give up and just let the agent go. You've lost your grip, but the PR still goes up.

_Has This Ever Happened To You?_
You are reading through an agent change, and it looks great, but you are well rested so you decide to really dig in on what happened. You realize that some benign looking code is actually not what you would expect, you start asking the LLM questions, you realize that a whole world of problems has been encountered and solved without you. If you had been involved you may have changed the goals to make this easier, and you certainly don't totally understand the solution because you didn't solve it yourself, but it seems fine. You briefly ponder how often this is happening in other changes, but you don't think about it too hard.

_Has This Ever Happened To You?_
You are usually super on top of making sure you understand what the agent is doing, but one day you are le tired, so you don't dig in as much. The next day you have a bunch of missing context, so it is harder to comb over the outputs, and you become le tired more and more often.

### And So

The speed of building should be exactly as fast as the speed of understanding. Slower and you get bored and inefficient, faster and you either lose touch or have to come back and laboriously rebuild understanding. Rebuilding understanding post-hoc is usually slower and more effortful than building it step by step as challenges are encountered and solutions are devised.

Requiring the human to drive means that there will be friction when there is uncertainty, and that will drive Theory Building. LLM classification driving most operations means that when there is no friction things happen pretty lickety split.

### Why Clutch0

I've had a pretty clear vision of what I wanted to build here for a while, and I have vibe coded several versions, but I wanted to rush into self hosting and use clutch to build itself ASAP.

100% of the time, when it was ready to edit itself the code would be incomprehensible to me, and I would spend all my time trying to understand and then unpick slop decisions. So I gave up, this codebase is purely vibe coded, and my intention is to build `clutch` from the ground up with this prototype


## Core loop

Clutch opens on a text box.  You can @mention files to add them to context, and you will accumulate a list of files in context.  Using the text box you can ask to take an action, and the LLM will classify which tool to run and which arguments to use.  Every time you issue a command, the full content of everything in context will be sent to the LLM.

Actions are things like "ask the llm", "edit the focused file", "run a command".  The results of actions can be saved into the list of context items, or optionally expose other tools (edit can either save the diff into context, or apply it to a file)

Each Context item has a one line summary underneath, and a longer summary shown when they are highlighted.  Most can be opened to see the entire content by pressing c

## Tools

- ### /add (or type @ to quick select files)

Adds a file to the files in context

- ### /ask

Ask the LLM a question.  The answer can be saved into context, and re-run.

- ### /agent-ask

Ask a question of an embedded agent session.  This creates a persistent context item that contains the whole agent history, allowing you to send followup messages.  Only the final message from the agent is included in the general context

- ### /edit

Edit the selected file according to the instructions you provide.

- ### /create

Create a new file

- ### /find-files 

Launch a pi session to find which files