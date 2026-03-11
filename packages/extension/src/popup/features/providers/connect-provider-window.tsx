import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutationResource } from "@llm-bridge/reactive-core";
import { ProviderAuthSchemaForm } from "@/popup/features/providers/provider-auth-schema-form";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Separator } from "@/shared/ui/separator";
import { useProviderConnectData } from "@/app/state/runtime-data";
import {
  cancelProviderAuthFlowMutation,
  startProviderAuthFlowMutation,
} from "@/app/state/runtime-mutations";

export function ConnectProviderWindow({ providerID }: { providerID: string }) {
  const [busyAction, setBusyAction] = useState<"cancel" | "start" | null>(null);
  const connectDataState = useProviderConnectData(providerID);
  const connectData = connectDataState.value;
  const startAuthFlow = useMutationResource(startProviderAuthFlowMutation);
  const cancelAuthFlow = useMutationResource(cancelProviderAuthFlowMutation);

  const provider = useMemo(
    () => (connectData?.providers ?? []).find((item) => item.id === providerID),
    [connectData, providerID],
  );

  const flow = connectData?.authFlow;
  const methods = useMemo(() => flow?.methods ?? [], [flow?.methods]);
  const instruction = flow?.instruction;

  const [selectedMethodID, setSelectedMethodID] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [successToastShown, setSuccessToastShown] = useState(false);

  const hasSelectedMethod = useMemo(
    () => methods.some((method) => method.id === selectedMethodID),
    [methods, selectedMethodID],
  );
  const selectedResolvedMethod = useMemo(
    () =>
      selectedMethodID
        ? (methods.find((method) => method.id === selectedMethodID) ?? null)
        : null,
    [methods, selectedMethodID],
  );

  useEffect(() => {
    if (!selectedMethodID) return;
    const exists = methods.some((method) => method.id === selectedMethodID);
    if (!exists) {
      setSelectedMethodID(null);
    }
  }, [methods, selectedMethodID]);

  useEffect(() => {
    if (flow?.status !== "error" && flow?.status !== "canceled") return;
    setSelectedMethodID(null);
  }, [flow?.status]);

  useEffect(() => {
    if (flow?.status !== "success") return;

    const timeout = window.setTimeout(() => {
      window.close();
    }, 1200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [flow?.status]);

  useEffect(() => {
    if (!flow) return;
    if (flow.status !== "success") {
      setSuccessToastShown(false);
      return;
    }
    if (successToastShown) return;

    setSuccessToastShown(true);
    toast.success(`${provider?.name ?? providerID} connected`);
  }, [flow, provider?.name, providerID, successToastShown]);

  async function handleStart(methodID: string, values: Record<string, string>) {
    setFlowError(null);
    setBusyAction("start");
    await startAuthFlow.execute({
      providerID,
      methodID,
      values,
    }).finally(() => {
      setBusyAction((current) => (current === "start" ? null : current));
    });
  }

  async function handleCancel() {
    if (!flow) {
      window.close();
      return;
    }

    if (flow.status === "authorizing") {
      setBusyAction("cancel");
      await cancelAuthFlow.execute({
        providerID,
        reason: "user",
      }).finally(() => {
        setBusyAction((current) => (current === "cancel" ? null : current));
      });
    }

    window.close();
  }

  async function handleCopyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Code copied");
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleOpenUrl(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const status = flow?.status ?? "idle";
  const isBusy = busyAction !== null;
  const isLoading = connectDataState.isLoading && connectData == null;
  const hasLoadFailure = connectDataState.hasError && connectData == null;

  const displayError =
    flowError ??
    (status === "error" || status === "canceled" ? flow?.error : null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[560px] flex-col px-4 py-6">
        <Card className="rounded-none border-border">
          <CardHeader className="px-5 py-4">
            <CardTitle className="text-sm font-semibold">
              Connect {provider?.name ?? providerID}
            </CardTitle>
            <CardDescription className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {status === "authorizing"
                ? "Authentication in progress"
                : "Select auth method"}
            </CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="px-5 py-4">
            {isLoading && (
              <p className="text-xs text-muted-foreground">
                Loading authentication flow...
              </p>
            )}

            {hasLoadFailure && (
              <p className="text-xs text-destructive">
                Failed to load authentication flow.
              </p>
            )}

            {!isLoading && !hasLoadFailure && methods.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No auth methods are available for this provider.
              </p>
            )}

            {status === "authorizing" && (
              <div className="flex flex-col gap-4">
                <p className="text-xs text-muted-foreground">
                  Finishing authentication...
                </p>

                {instruction && (
                  <div className="flex flex-col gap-3 bg-secondary/20 px-4 py-3">
                    <p className="text-xs font-medium text-foreground">
                      {instruction.title}
                    </p>
                    {instruction.message && (
                      <p className="text-xs text-muted-foreground">
                        {instruction.message}
                      </p>
                    )}

                    {instruction.code &&
                      (() => {
                        const code = instruction.code;
                        return (
                          <div className="flex items-center justify-between gap-2 bg-background px-3 py-2 shadow-sm">
                            <code className="text-xs text-foreground">
                              {code}
                            </code>
                            <Button
                              onClick={() => {
                                void handleCopyCode(code);
                              }}
                              disabled={isBusy}
                              variant="secondary"
                              size="sm"
                            >
                              Copy code
                            </Button>
                          </div>
                        );
                      })()}

                    {instruction.url &&
                      (() => {
                        const url = instruction.url;
                        return (
                          <div className="flex items-center justify-between gap-2">
                            <Button
                              onClick={() => handleOpenUrl(url)}
                              disabled={isBusy}
                              variant="secondary"
                              size="sm"
                            >
                              Open verification page
                            </Button>
                            {instruction.autoOpened && (
                              <p className="text-[11px] text-muted-foreground">
                                Opened automatically
                              </p>
                            )}
                          </div>
                        );
                      })()}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button
                    onClick={() => {
                      void handleCancel().catch((error) => {
                        setFlowError(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      });
                    }}
                    disabled={isBusy}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {status === "success" && (
              <div className="flex flex-col items-center justify-center gap-3 py-6">
                <div className="flex items-center justify-center rounded-full bg-primary/10 p-3 text-primary">
                  <Check className="size-6" />
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {provider?.name ?? providerID} connected successfully
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Closing window...
                  </p>
                </div>
              </div>
            )}

            {status !== "authorizing" && status !== "success" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  {methods.map((method) => (
                    <Button
                      key={method.id}
                      onClick={() => {
                        setSelectedMethodID(method.id);
                        setFlowError(null);
                      }}
                      variant="outline"
                      className="w-full justify-between px-4 py-3 text-left hover:bg-secondary/40"
                    >
                      <span className="text-xs font-medium text-foreground">
                        {method.label}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {method.type}
                      </span>
                    </Button>
                  ))}
                </div>

                {hasSelectedMethod && (
                  <>
                    {selectedResolvedMethod && (
                      <ProviderAuthSchemaForm
                        key={selectedResolvedMethod.id}
                        method={selectedResolvedMethod}
                        disabled={isBusy}
                        error={displayError}
                        submitLabel={
                          busyAction === "start" ? "Starting..." : "Continue"
                        }
                        onBack={() => {
                          setSelectedMethodID(null);
                          setFlowError(null);
                        }}
                        onSubmit={(values) =>
                          handleStart(selectedResolvedMethod.id, values)
                        }
                      />
                    )}

                    {!selectedResolvedMethod && (
                      <div className="mt-2 bg-secondary/20 px-4 py-4">
                        <p className="text-xs text-muted-foreground">
                          Authentication method is no longer available.
                        </p>
                      </div>
                    )}
                  </>
                )}

                {!hasSelectedMethod && (
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex-1">
                      {displayError && (
                        <p className="text-xs text-destructive">
                          {displayError}
                        </p>
                      )}
                    </div>
                    <Button
                      onClick={() => {
                        void handleCancel().catch((error) => {
                          setFlowError(
                            error instanceof Error
                              ? error.message
                              : String(error),
                          );
                        });
                      }}
                      disabled={isBusy}
                      variant="ghost"
                    >
                      Close
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
