/// helpText.tsjust holds the big ass help string.
///

export const HELP_TEXT = 
    `SGFEditor can read and write .sgf files, edit game trees, etc.

The following describes command and key bindings, but you can use commands
from buttons in the upper right of the display and from the app bar (right
click on the game board or drag up from the bottom of the display).

PLACING STONES AND ANNOTATIONS:
Click on board location to place alternating colored stones.  You can click the
last move in a series of moves to undo or delete it.  Shift click to place square 
annotations, ctrl click for triangles, and alt click to place letter annotations.  
If you click on an adornment location twice, it toggles whether there is an adornment.

KEEPING FOCUS ON BOARD FOR KEY BINDINGS
Escape will always return focus to the board so that the arrow keys work
and are not swallowed by the comment editing pane.

NAVIGATING MOVES IN GAME TREE
Right arrow moves to the next move, left moves to the previous, up arrow selects
another branch or the main branch, down arrow selects another branch, home moves
to the game start, and end moves to the end of the game following the currently
selected branches.  You can always click a node in the game tree graph.  Ctrl-left
arrow moves to the closest previous move that has branches.  If the current move
has branches following it, the selected branch's first node has a fucshia
square outlining it.  Nodes that have comments have a light green highlight, and
the current node has a fuchsia highlight.

CREATING NEW FILES
The new button (or ctrl-n) prompts for game info (player names, board size,
handicap, komi) and creates a new game.  If the current game is dirty, this prompts
to save.

OPENING EXISTING FILES
The open button (or ctrl-o) prompts for a .sgf file name to open.  If the current
game is dirty, this prompts to save.  Opening a file already open switches to that game.
Ctrl-c copies filepath to clipboard.

MULTIPLE OPEN FILES
You can have up to 10 games open.  Ctrl-w rotates through games.  Ctrl-g brings up 
a dialog for switching to games and closing games.  When creating or opening games, 
SgfEditor closes the default game if it is unused.

SAVING FILES, SAVE AS
The save button (or ctrl-s) saves to the associated file name if there is one;
otherwise it prompts for a filename.  If there is a filename, but the game state
is not dirty, then it prompts to save to a different filename (and tracks to the
new name).  To explicitly get save-as behavior, use ctrl-alt-s (browser) or 
ctrl-shift-s (electron).  Ctrl-c copies filepath to clipboard.

SAVING REVERSE VIEW
To save the game so that your opponent can review it from their point of view, use
ctrl-shift-alt-f in browser and electron.

CUTTING MOVES/SUB-TREES AND PASTING
Delete or c-x cuts the current move (and sub tree), making the previous move the
current move.  C-v will paste a cut sub tree to be a next move after the current
move.  If the the sub tree has a move that occupies a board location that already
has a stone, you will not be able to advance past this position.  You can paste a
cut sub tree from a second open game with c-s-v.

MOVING BRANCHES
You can move branches up and down (affects branch combo and game tree display)
You must be on the first move of a branch, and then you can use ctrl-uparrow or 
ctrl-downarrow to move the branch up or down to change the order of branches.

PASSING
The Pass button or c-p will make a pass move.

SETTINGS
C-u brings up a dumb settings dialog where you can change some font sizes and sizes
of UI elements.  There currently is not a lot of rigor and checking of input values.

MISCELLANEOUS
   F1 produces this help.
   Ctrl-k clears the current node's comment and puts text on system clipboard.
   Ctrl-1, ..., ctrl-5 deletes the first, ..., fifth line of node's comment and
      puts entire comment's text on clipboard.
   Ctrl-t changes the first occurrence of the move's board coordinates in the comment
      to 'this'; for example, 'd6 is strong cut' changes to 'this is strong cut'.
   Ctrl-m changes the first occurrence of board coordinates to 'marked stone',
      'square-marked stone', or a letter depending on what adornment is at that location.
`;
