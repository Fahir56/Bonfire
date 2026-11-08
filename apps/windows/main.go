// Bonfire for Windows: no web framework dependency, no server secrets on the client.
// Opens the user-configured Bonfire URL as a borderless browser app window via
// installed Microsoft Edge or Chrome (uses the system default browser as fallback).
package main

import (
 "fmt"
 "net/url"
 "os"
 "os/exec"
 "path/filepath"
 "strings"
 "syscall"
 "unsafe"
)

func info(title, message string) {
 user32:=syscall.NewLazyDLL("user32.dll")
 box:=user32.NewProc("MessageBoxW")
 tp,_:=syscall.UTF16PtrFromString(title)
 mp,_:=syscall.UTF16PtrFromString(message)
 box.Call(0,uintptr(unsafe.Pointer(mp)),uintptr(unsafe.Pointer(tp)),0x40)
}
func validURL(s string) bool {
 if strings.ContainsAny(s,"\r\n\x00") {return false}
 u,err:=url.Parse(strings.TrimSpace(s))
 if err!=nil||u.Hostname()==""||u.User!=nil||u.Fragment!="" {return false}
 if strings.EqualFold(u.Scheme,"https") {return !strings.Contains(u.Hostname(),"YOUR-BONFIRE")}
 return u.Scheme=="http"&&(u.Hostname()=="localhost"||u.Hostname()=="127.0.0.1")
}
func main(){
 cfgBase,err:=os.UserConfigDir();if err!=nil {info("Bonfire", "Couldn't locate the Windows settings folder.");return}
 cfgDir:=filepath.Join(cfgBase,"Bonfire")
 if err=os.MkdirAll(cfgDir,0700);err!=nil {info("Bonfire", "Couldn't create the settings folder.");return}
 cfg:=filepath.Join(cfgDir,"server-url.txt")
 if len(os.Args)>=2 && strings.HasPrefix(os.Args[1],"--url=") {
  value:=strings.TrimSpace(strings.TrimPrefix(os.Args[1],"--url="))
  if validURL(value) {os.WriteFile(cfg,[]byte(value+"\n"),0600)} else {info("Bonfire", "Use a real https:// Bonfire URL (or http://localhost for development).");return}
 }
 data,_:=os.ReadFile(cfg)
 website:=strings.TrimSpace(string(data))
 if !validURL(website){
  exe,_:=os.Executable()
  shipped,_:=os.ReadFile(filepath.Join(filepath.Dir(exe),"Bonfire-Server-URL.txt"))
  if validURL(strings.TrimSpace(string(shipped))){website=strings.TrimSpace(string(shipped));os.WriteFile(cfg,[]byte(website+"\n"),0600)}
 }
 if !validURL(website){
  if len(data)==0 {os.WriteFile(cfg,[]byte("https://YOUR-BONFIRE-SERVICE.onrender.com\n"),0600)}
  info("Set up Bonfire",fmt.Sprintf("Set your real deployed Bonfire website address in:\n%s\n\nUse https://... without extra text, save the file, then open Bonfire again.",cfg))
  exec.Command("notepad.exe",cfg).Start()
  return
 }
 programFiles:=[]string{os.Getenv("ProgramFiles(x86)"),os.Getenv("ProgramFiles"),os.Getenv("LocalAppData")}
 candidates:=[]string{"msedge.exe","chrome.exe"}
 for _,base:=range programFiles {if base=="" {continue};candidates=append(candidates,
  filepath.Join(base,"Microsoft","Edge","Application","msedge.exe"),
  filepath.Join(base,"Google","Chrome","Application","chrome.exe"))}
 for _,candidate:=range candidates {
  if !strings.Contains(candidate,"\\") {if _,err:=exec.LookPath(candidate);err!=nil {continue}} else {if stat,err:=os.Stat(candidate);err!=nil||stat.IsDir(){continue}}
  cmd:=exec.Command(candidate,"--app="+website,"--new-window")
  if err:=cmd.Start();err==nil {return}
 }
 if err:=exec.Command("rundll32.exe","url.dll,FileProtocolHandler",website).Start();err!=nil {info("Bonfire", "Could not open your web browser: "+err.Error())}
}
