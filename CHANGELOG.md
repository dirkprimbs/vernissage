# Changelog

## 0.5.0 — 2026-11-14

- **Contact link:** a gallery can name a contact address (`contact`, *Contact address* under Menu bar in the studio). The menu bar then ends with a *Contact* link that opens an email to it (*Kontakt* when the gallery's `locale` is German). It shows even when the menu has no other links.

## 0.4.0 — 2026-11-13

- **New galleries** start with one tall room (12 × 9 m, 4.6 m high): three closed walls for art, a windowed north wall onto the Toronto skyline, and an entry door. They use the look of the American Photographs demo (Industrial Loft, Daylight, immersive focus view).
- **Entry door:** a door in the first room with a lit sign naming where it leads. Visitors start just inside it. A click from across the room walks to it; a click from close by opens the link (`entrance.url`, default `https://primbs.ca`). In the studio's preview it only says where it leads.
- **Windows per wall:** each wall can be windowed or closed (`walls.<side>.windows`).
- **Automatic sizing:** works are sized and spaced to suit their wall. Every work starts with the same area whatever its shape; the wall then scales them together, so few works come out large and many come out smaller. Each work has a Size slider to make it larger or smaller than its neighbours. Older projects keep true-size hanging (`display.sizing: "true"`).
- **Gallery from a Google Photos album:** paste the link of an album shared by link (studio start screen, or `vernissage import-album <link> <folder>`). Photos are downloaded, rooms are suggested from their number and shapes, and a panorama always gets a wall to itself. Labels start with the file name as title, the date, the camera and its settings, and the caption from the album.
- **Studio:** the editor folds away (button or Ctrl+E) so the gallery fills the window. The Gallery pane is reduced to title, indoor light, entry door and scenery. Rooms can be dragged to position them in any arrangement. A new project may use a folder that has files in it, after a confirmation that names what will be deleted; the home folder, Documents, Desktop and the like are refused.
- **Fix: pictures that looked unlit.** The real spotlights went to the works nearest in a straight line, so works in the next room could take a light from one in front of the visitor. They now go to the visitor's own room first (8 lights at medium quality, 14 at high), and a work without a real light gets a painted pool of light of about the same strength.
- **Fix: plants crowding pictures.** Corner plants are left out where a picture, label or the entry door is within about a metre.
- **Plants on bare walls.** A stretch of closed wall with nothing hung on it (2.2 m or longer) gets a plant in its middle, larger on longer stretches.
- **Start view:** a gallery can open in the 3D gallery (default) or in the portfolio (`startIn`). Opening in the portfolio builds the 3D scene only when a visitor walks in.
- **Menu bar:** up to eight links to other web pages (`menu`), shown at the top of the gallery and the portfolio; on narrow screens they fold into a Menu button.
- **Portfolio button** in the gallery's toolbar (it was hidden in More). The portfolio keeps its room filter and drops the search field.
- **Studio:** the editor has a fixed width and the preview takes the rest of the window. The start screen fits the window in two columns, and recent projects show the folder name first. Projects opened by the development hook no longer enter the recent list.
- **Live preview without reloading.** Edits in the studio are sent into the running preview, which rebuilds the rooms in place (about 40 ms for a two-room gallery): you keep your position and view, loaded images are reused, and the outdoors is rebuilt only when the scenery or the building's footprint changes. The Reload button still reloads fully.
- **Size sliders that behave.** Resizing one work no longer changes the others: a wall's common size is worked out as if every work were at its normal size. Only when the resized works no longer fit does everything shrink together, with a warning ("the wall is full: all works shown at 78% to fit"). Each work shows its actual size in cm beside its slider. Only the grip (⠿) and the thumbnail pick a work up for moving to another wall, so dragging a slider no longer drags the row.
- **Rooms snap into place.** A room dragged in the Rooms editor docks flush against a side of another room and slides along it (with a pull towards lined-up edges and centres). It can never be dropped inside another room, and a drop that would leave any room unreachable is refused. In free placement, touching rooms get a doorway whatever their tour order, and rooms further apart never do, so there are no more corridors across open ground. Resizing, adding or removing a room moves the rooms after it so they still touch. Overlapping or unreachable rooms in a hand-edited `gallery.json` are reported.
- **Closing the studio.** The window's close button, Ctrl+Q and the Close button all close the app; with unsaved changes the studio asks "Save / Don't save / Cancel" instead of silently refusing to close. File › Close project (Ctrl+W) returns to the start screen.
- **Boats keep Toronto's hours.** The sailboats are out by day and back in their moorings after nightfall. The Toronto Island ferry crosses between its terminal at the foot of Bay Street and the island, stopping at each dock; it runs from 6:00 to 23:00 on Toronto's clock (daylight saving time included), finishes its last trip at the city pier and stays tied up overnight with only a few lights on. With a fixed time of day, a typical hour is used (night counts as 1:00).
- **Opening an export from the folder.** A site opened straight from disk (`file://`) can only show the portfolio, because browsers refuse WebGL images from local files. The portfolio now says so and what to do (upload the folder, or use Open in browser). The Build pane explains the same, and its Open in browser and Show in folder buttons are available for an earlier build too, not only right after building.
- **Artworks editor redesigned** (was Library). A strip of thumbnails picks the work (dashed outline: not hung yet); below it one form: a *Hangs on* menu to hang or move the work, previous/next, *Show in preview*, then the label fields (title, artist, date, medium, description). Rarer fields sit under *More details* and *Frame and light*, which open by themselves when filled in. Provenance entries are cards with date, event and note. New works take the artist of the work being edited, and one click applies an artist to all works. Typing one side of the real size fills in the other. Rows still being typed (a provenance entry, a menu link) no longer raise errors or stop the preview.
- Schema v5: `entrance`, `display.sizing`, `walls.<side>.windows`. Older projects are migrated and keep their behaviour.

## 0.3.0 — 2026-11-13

- **First person only.** Avatars, the third-person view, the *Name & avatar* lobby step, name tags and emoji reactions are gone; *Join gallery* goes straight in. The toolbar loses its View and React buttons. The studio's Avatars pane is removed, and *Social space* becomes *Navigation* (teleport, lobby orbit).
- **One look:** Industrial Loft and Daylight are the defaults, and the studio no longer offers style choices. All demos use them.
- **Exterior views rebuilt.** The outdoors is now a scene of its own, drawn behind the rooms with its own light and haze. A shader sky replaces the painted one: drifting clouds, the sun in its real place, stars and the moon in its phase. The lake is a real mirror with ripples. The **Toronto skyline** was remodelled in real metres (CN Tower with its legs, pod and mast; Rogers Centre; some fifty landmark towers with setbacks, crowns and spires; seeded districts around them; a ferry and sailboats); windows light up at dusk and beacons blink. The **lake shore** has better trees, a dock, a wooded far shore and two ranges of hills.
- **Live time and weather.** The sky follows Toronto's time of day (computed in the browser) and current weather (Environment and Climate Change Canada): clear, cloudy, rain, thunderstorm, snow or fog, with rain and snow falling outside, snow settling, fog and lightning. In the Daylight scenario the rooms follow the sky and the spotlights take over at night. Visitors can fix either in the Light menu; gallery owners in the studio. A fixed weather means no third-party request.
- **Sky and skylights:** a painted sky (clear, golden hour, overcast or starry night; *auto* follows the lighting scenario). Every room 5 m wide or more gets a glazed roof lantern with daylight falling onto the floor. Bare outside walls get picture windows. There are potted plants in the corners.
- **Bigger works:** the new `display` block scales works (default 120 %), frame mouldings and mats (160 %) and wall labels (135 %).
- **Wall label close-up:** click a label, press **L**, or choose *Label* in the object menu. The label opens large in its gallery style with the full provenance, text-size controls and a link to inspect the artwork. The 3D label now also carries a one-line provenance summary.
- **Wheel zoom in first person:** the mouse wheel (and pinch) zooms the view up to about 4×, and looking around slows down to match. Press the wheel or Esc to reset; moving to a work or teleporting also resets it.
- **Fix: flickering door frames.** Neighbouring rooms were placed one wall thickness apart, but each room has its own wall, so the two walls overlapped by 10 cm. In each doorway, the cut wall ends and the beams over the door of both rooms shared the same planes and z-fought. Rooms now keep at least two wall thicknesses apart (the default gap is 0.4 m), and the passage only fills the space between the two outer wall faces.
- Schema v4: new `display`, `environment` and `navigation` blocks; `avatar` and `social` removed; `environment.landscape` is `lake` or `toronto`; `environment.time` and `environment.weather` replace `sky`. Older projects are migrated automatically when opened or built.
- Fix: the outdoor scenery was centred on the world origin rather than on the building, so long rows of rooms could overhang the island.
- Studio: *Surroundings* and *Display size* sections in the Gallery pane; the *Gallery style* section is gone.

## 0.2.0 — 2026-11-13

The interface is now modelled on Mozilla Hubs' look and feel. Only the patterns and design tokens are reused, not its code.

- Lobby: loading screen, room-entry card, *Name & avatar* card with a 3D avatar preview, slow camera orbit behind it.
- Bottom toolbar with colour-coded round buttons; Share, Lighting, React and More popovers; Artworks and Rooms sidebars; notifications at the bottom left; Poppins typeface.
- Floating half-body avatars (new default; full figure still available) with name tags; emoji reactions.
- Hover outline on artworks and a dark object menu (Inspect / Walk here / Source / Share, plus tour paging); Space/Tab opens it, Enter inspects.
- Q/E snap turn; right-click / long-press teleport with arc and landing ring.
- New **Pavilion** style (default for new projects).
- Schema: `avatar.look` and the `social` block (`nameTags`, `reactions`, `teleport`, `lobbyOrbit`); studio controls for them. Studio accent switched to blue.
- Fixes: picking beyond 3.5 m failed after the third-person camera's collision ray shortened the shared raycaster; SVG works showed black in the studio preview (now rasterised); share links no longer carry the page's query string.

## 0.1.0 — 2026-11-13

First version.

- **Schema** (`@vernissage/schema`): gallery config with validation, migrations and per-field issues; 5 gallery styles, 5 lighting scenarios, 7 frames, 5 default avatars; floor-plan layout (enfilade, serpentine grid, free) with automatic doorways and passages; wall hanging (centred, salon, grid) at true scale, avoiding doors; 2D collision.
- **Viewer**: three.js gallery with procedural rooms, frames, mats, wall labels and light pools; a pooled spotlight rig; a third-person avatar with a walk cycle and first-person toggle; keyboard, mouse, click-to-walk with door routing, touch joystick; minimap; texture streaming. Focus mode in four layouts with zoom; portfolio grid with search; deep links; fallback to the portfolio without WebGL or on `file://`.
- **Generator / CLI**: image variants with sharp (WebP thumbs and textures; SVG rasterised for 3D and sanitised for focus mode), content-hash cache, inlined data, build report, output-folder safety check, `build`, `validate` and `serve` commands.
- **Studio** (Electron + Svelte 5): gallery, floor plan, walls, library and provenance, avatars and build panes; live 3D preview; validation badge; AppImage and .deb packaging.
- **Demos**: Leonardo da Vinci (15 works), American Photographs from the Library of Congress (11), Masterpieces in Vector (11 SVG traces); licence-checked fetcher and VTracer vectoriser.
