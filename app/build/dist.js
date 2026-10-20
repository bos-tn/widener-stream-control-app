// Builds the Windows installer (v2.3.0: one installer for every profile).
//   npm run dist
// The installer carries every profile in profiles/ and installs Esports
// Stream Control under the app id the Widener app always had, so a Widener
// install updates in place through latest.yml. The app runs one profile at a
// time (main.js). Output: dist/app/.
//
// Default profile: the installer's Profile page ("Choose a team or league
// profile": Teams, then Leagues), or `--profile=<id>` on its command line for
// a silent install, writes resources\default-profile.ini; an update keeps
// it. main.js opens it (see installerScript below).
//
// Replaced apps: a profile's `replaces` block (profile.js) names an app from
// before v2.3.0 that held only that profile (LotE Stream Control). Its
// update channel gets a copy of latest.yml (dist/app/<channel>.yml), so that
// app downloads this installer as its next update; the installer then
// removes it (dist/app/installer.nsh, written here), keeping its data folder,
// which the profile reads. Both .yml files go in the release.
const fs = require('fs');
const path = require('path');
const { build, Platform } = require('electron-builder');
const { UUID } = require('builder-util-runtime');
const pkg = require('../package.json');
const { listProfiles, loadProfile } = require('../profile');

const OUT_DIR = path.resolve(__dirname, '..', process.env.STREAM_BUILD_OUTPUT || pkg.build.directories.output);
// electron-builder's own namespace for an app id's GUID (NsisTarget.js), so
// this finds the registry keys the replaced app's installer wrote.
const ELECTRON_BUILDER_NS_UUID = UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3');

// Every profile loads, and no two share a port (each profile's OBS scenes
// point at its own) or a data folder.
function checkProfiles() {
  const profiles = listProfiles().map((id) => loadProfile(id));
  ['port', 'dataFolder'].forEach((k) => {
    const seen = {};
    profiles.forEach((p) => {
      if (seen[p[k]]) throw new Error(`Profiles "${seen[p[k]]}" and "${p.id}" have the same ${k} (${p[k]}).`);
      seen[p[k]] = p.id;
    });
  });
  profiles.forEach((p) => {
    if (p.replaces && p.replaces.appId === pkg.build.appId) throw new Error(`Profile "${p.id}" replaces this app's own app id.`);
    // A licensed font is kept out of the repository (see the README in its
    // assets/fonts folder). The installer works without one: that typeface
    // is left out of the choice, and with none the headlines use the
    // fallback.
    p.headlineFonts.missing.forEach((f) => {
      console.warn(`WARNING: profiles/${p.id}/assets/${f} is missing, so this installer won't offer that headline typeface. See the README in that folder.`);
    });
  });
  return profiles;
}

// A string for an NSIS script: $ and " escaped.
const nsisText = (s) => String(s).replace(/\$/g, '$$$$').replace(/"/g, '$\\"');

// The installer script, run inside electron-builder's own (templates/nsis in
// app-builder-lib):
// - the default profile: the Profile page (one list, Teams then Leagues),
//   --profile=<id> on the command line (silent installs), the one kept from
//   the install being updated, or, on a first install, the profile of the
//   one-profile app it replaces. Written to resources\default-profile.ini
//   ([profile] id, set = when it was picked); main.js opens it.
// - the apps from before v2.3.0 that held one profile (`replaced`), which it
//   removes, keeping their data folders.
// choices: [{ id, kind, name }], teams first.
function installerScript(replaced, choices = []) {
  const ini = '"$INSTDIR\\resources\\default-profile.ini"';
  const stamp = [
    '  Push $0', '  Push $1', '  Push $2', '  Push $3', '  Push $4', '  Push $5', '  Push $6',
    '  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6',
    // GetTime does not pad every field, so the separators keep two
    // times from reading the same.
    '  StrCpy $defaultProfileSet "$2.$1.$0T$4.$5.$6"',
    '  Pop $6', '  Pop $5', '  Pop $4', '  Pop $3', '  Pop $2', '  Pop $1', '  Pop $0',
  ];
  const lines = [
    '; Written by build/dist.js; do not edit.',
    '',
    '!ifndef BUILD_UNINSTALLER',
    'Var defaultProfile',
    'Var defaultProfileSet',
    'Var freshInstall',
    'Var profilePage',
    'Var profileBold',
    ...choices.map((c, i) => `Var profileRadio${i}`),
    '!endif',
    '',
    '!macro profileStamp',
    ...stamp,
    '!macroend',
    '',
    '!macro customInit',
    '  Push $R0',
    '  Push $R1',
    '  ; Nothing of this app installed here before.',
    '  StrCpy $freshInstall "0"',
    '  ${if} $hasPerMachineInstallation == "0"',
    '  ${andIf} $hasPerUserInstallation == "0"',
    '    StrCpy $freshInstall "1"',
  ];
  replaced.forEach((r) => {
    lines.push(
      '    ; A replaced app installed for all users: this install is for all',
      '    ; users too, in Program Files like it (a silent update elevates).',
      `    ReadRegStr $R0 HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${r.guid}" "UninstallString"`,
      '    ${if} $R0 != ""',
      '      StrCpy $hasPerMachineInstallation "1"',
      '      !insertmacro setInstallModePerAllUsers',
      '    ${endif}',
    );
  });
  lines.push(
    '  ${endif}',
    '  ; The default profile of the install being updated.',
    `  ReadINIStr $defaultProfile ${ini} "profile" "id"`,
    `  ReadINIStr $defaultProfileSet ${ini} "profile" "set"`,
    '  ; --profile=<id> on the command line.',
    '  ${GetParameters} $R0',
    '  ClearErrors',
    '  ${GetOptions} $R0 "--profile=" $R1',
    '  ${ifNot} ${Errors}',
  );
  choices.forEach((c, i) => {
    lines.push(
      `    ${i ? '${elseIf}' : '${if}'} $R1 == "${c.id}"`,
      `      StrCpy $defaultProfile "${c.id}"`,
      '      !insertmacro profileStamp',
    );
  });
  if (choices.length) lines.push('    ${endif}');
  lines.push(
    '  ${endif}',
    '  Pop $R1',
    '  Pop $R0',
    '!macroend',
    '',
  );

  // The Profile page, after the folder page. Not on an update.
  const rows = [];
  let y = 26;
  ['team', 'league'].forEach((kind) => {
    const group = choices.map((c, i) => ({ ...c, i })).filter((c) => c.kind === kind);
    if (!group.length) return;
    rows.push(
      `  \${NSD_CreateLabel} 0 ${y}u 100% 10u "${kind === 'team' ? 'Teams' : 'Leagues'}"`,
      '  Pop $0',
      '  SendMessage $0 ${WM_SETFONT} $profileBold 0',
    );
    y += 12;
    group.forEach((c) => {
      rows.push(
        `  \${NSD_CreateRadioButton} 8u ${y}u 92% 12u "${nsisText(c.name)}"`,
        `  Pop $profileRadio${c.i}`,
        `  \${NSD_OnClick} $profileRadio${c.i} profilePageClick`,
        `  \${if} $defaultProfile == "${c.id}"`,
        `    \${NSD_Check} $profileRadio${c.i}`,
        '  ${endif}',
      );
      y += 13;
    });
    y += 6;
  });
  if (y > 140) console.warn(`WARNING: the installer's Profile page runs to ${y} dialog units; it shows about 140.`);
  lines.push(
    '!macro customPageAfterChangeDir',
    '  Page custom profilePageShow profilePageLeave',
    '',
    '  Function profilePageShow',
    '    ${if} ${isUpdated}',
    '      Abort',
    '    ${endif}',
    '    !insertmacro MUI_HEADER_TEXT "Profile" "Choose a team or league profile"',
    '    nsDialogs::Create 1018',
    '    Pop $profilePage',
    '    ${if} $profilePage == error',
    '      Abort',
    '    ${endif}',
    '    CreateFont $profileBold "$(^Font)" "$(^FontSize)" 700',
    '    ${NSD_CreateLabel} 0 0 100% 20u "The app opens this profile when it starts. Settings, Profile, Change profile switches to another."',
    '    Pop $0',
    ...rows.map((l) => `  ${l}`),
    '    Push 0',
    '    Call profilePageClick',
    '    nsDialogs::Show',
    '  FunctionEnd',
    '',
    '  ; One checked across both lists; Next once one is.',
    '  Function profilePageClick',
    '    Exch $0',
    '    Push $1',
    '    Push $2',
    ...choices.flatMap((c, i) => [
      `    \${if} $0 != 0`,
      `    \${andIf} $0 != $profileRadio${i}`,
      `      \${NSD_Uncheck} $profileRadio${i}`,
      '    ${endif}',
    ]),
    '    StrCpy $1 0',
    ...choices.flatMap((c, i) => [
      `    \${NSD_GetState} $profileRadio${i} $2`,
      '    ${if} $2 == ${BST_CHECKED}',
      '      StrCpy $1 1',
      '    ${endif}',
    ]),
    '    GetDlgItem $2 $HWNDPARENT 1',
    '    EnableWindow $2 $1',
    '    Pop $2',
    '    Pop $1',
    '    Pop $0',
    '  FunctionEnd',
    '',
    '  ; A pick on this page is new each time, so the app opens it once even',
    '  ; when it is the profile the last install had.',
    '  Function profilePageLeave',
    '    Push $0',
    '    StrCpy $defaultProfile ""',
    ...choices.flatMap((c, i) => [
      `    \${NSD_GetState} $profileRadio${i} $0`,
      '    ${if} $0 == ${BST_CHECKED}',
      `      StrCpy $defaultProfile "${c.id}"`,
      '    ${endif}',
    ]),
    '    Pop $0',
    '    ${if} $defaultProfile == ""',
    '      Abort',
    '    ${endif}',
    '    !insertmacro profileStamp',
    '  FunctionEnd',
    '!macroend',
    '',
    '; One replaced app installed under ROOT. Left alone while it runs: its',
    '; uninstaller would close it, perhaps mid-stream; the next update tries',
    '; again. An all-users install needs this installer to run as admin.',
    '!macro removeReplacedApp ROOT MODE GUID EXE',
    '  ; $R1: 1 to remove it. tasklist | find exits 1 when the app is not',
    '  ; running (0 when it is; anything else is not known).',
    '  StrCpy $R1 "0"',
    '  ReadRegStr $R0 ${ROOT} "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${GUID}" "UninstallString"',
    '  ${if} $R0 != ""',
    '    ${if} "${MODE}" == "/currentuser"',
    '    ${orIf} ${UAC_IsAdmin}',
    '      nsExec::Exec `"$SYSDIR\\cmd.exe" /c tasklist /FI "IMAGENAME eq ${EXE}" /FO csv | "$SYSDIR\\find.exe" /I "${EXE}"`',
    '      Pop $R1',
    '      ${if} $R1 != "1"',
    '        StrCpy $R1 "0"',
    '      ${endif}',
    '    ${endif}',
    '  ${endif}',
    '  ${if} $R1 == "1"',
    '    !insertmacro GetInQuotes $R2 "$R0"',
    '    ReadRegStr $R3 ${ROOT} "Software\\${GUID}" "InstallLocation"',
    '    ${if} $R3 == ""',
    '      ${GetParent} "$R2" $R3',
    '    ${endif}',
    '    ${if} ${FileExists} "$R2"',
    '      DetailPrint "Removing the replaced app in $R3"',
    '      CopyFiles /SILENT "$R2" "$PLUGINSDIR\\replaced-uninstaller.exe"',
    '      ExecWait \'"$PLUGINSDIR\\replaced-uninstaller.exe" /S /KEEP_APP_DATA ${MODE} --updated _?=$R3\'',
    '      Delete "$PLUGINSDIR\\replaced-uninstaller.exe"',
    '      RMDir "$R3"',
    '    ${endif}',
    '  ${endif}',
    '!macroend',
    '',
    '!macro customInstall',
    '  Push $R0',
    '  Push $R1',
    '  Push $R2',
    '  Push $R3',
  );
  replaced.forEach((r) => {
    lines.push(
      '  ; A first install with no default, on a PC that has this replaced app:',
      '  ; its profile (even while it runs, and stays for now).',
      '  ${if} $freshInstall == "1"',
      '  ${andIf} $defaultProfile == ""',
      `    ReadRegStr $R0 HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${r.guid}" "UninstallString"`,
      `    ReadRegStr $R1 HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${r.guid}" "UninstallString"`,
      '    ${if} $R0 != ""',
      '    ${orIf} $R1 != ""',
      `      StrCpy $defaultProfile "${r.profile}"`,
      '      !insertmacro profileStamp',
      '    ${endif}',
      '  ${endif}',
      `  !insertmacro removeReplacedApp HKEY_CURRENT_USER "/currentuser" "${r.guid}" "${r.exe}"`,
      `  !insertmacro removeReplacedApp HKEY_LOCAL_MACHINE "/allusers" "${r.guid}" "${r.exe}"`,
    );
  });
  lines.push(
    '  Pop $R3',
    '  Pop $R2',
    '  Pop $R1',
    '  Pop $R0',
    '  ${if} $defaultProfile != ""',
    `    WriteINIStr ${ini} "profile" "id" "$defaultProfile"`,
    `    WriteINIStr ${ini} "profile" "set" "$defaultProfileSet"`,
    '  ${endif}',
    '!macroend',
    '',
  );
  return lines.join('\r\n');
}

async function main() {
  const profiles = checkProfiles();
  const replaced = profiles.filter((p) => p.replaces).map((p) => ({
    profile: p.id,
    guid: UUID.v5(p.replaces.appId, ELECTRON_BUILDER_NS_UUID),
    exe: `${p.replaces.appName}.exe`,
    channel: p.replaces.channel,
  }));
  replaced.forEach((r) => {
    if (!/^[A-Za-z0-9 ._-]+\.exe$/.test(r.exe) || !/^[a-z0-9-]+$/.test(r.channel)) throw new Error(`Profile "${r.profile}": bad replaces block.`);
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const nshFile = path.join(OUT_DIR, 'installer.nsh');
  const kinds = ['team', 'league'];
  const choices = profiles.map((p) => ({ id: p.id, kind: p.kind, name: p.name }))
    .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.name.localeCompare(b.name));
  fs.writeFileSync(nshFile, installerScript(replaced, choices));

  // Written out whole and passed as a file: given as an object,
  // electron-builder merges it into package.json's "build" (and folds a
  // publish list into its first entry, which breaks it).
  const configFile = path.join(OUT_DIR, 'build.json');
  const config = { extends: null, ...pkg.build, directories: { ...pkg.build.directories, output: OUT_DIR }, nsis: { ...pkg.build.nsis, include: nshFile } };
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log(`\n=== ${pkg.build.productName} ${pkg.version}: ${profiles.map((p) => p.id).join(', ')} ===`);
  await build({
    projectDir: path.join(__dirname, '..'),
    targets: Platform.WINDOWS.createTarget('nsis'),
    config: configFile,
    publish: 'never',
  });

  // The replaced apps' update channels point at this installer.
  const latest = path.join(OUT_DIR, 'latest.yml');
  replaced.forEach((r) => {
    fs.copyFileSync(latest, path.join(OUT_DIR, `${r.channel}.yml`));
    console.log(`${r.channel}.yml: a copy of latest.yml, for ${r.exe} (profile ${r.profile})`);
  });
}

module.exports = { checkProfiles, installerScript };

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
}
